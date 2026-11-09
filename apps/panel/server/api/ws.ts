import type { Peer } from 'crossws'
import { z } from 'zod'

const ClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), topic: z.string().regex(/^job:\d+$/) }),
  z.object({ type: z.literal('unsubscribe'), topic: z.string().max(64) }),
])

const subscriptions = new Map<string, Map<string, () => void>>()

const send = (peer: Peer, topic: string, data: unknown) => {
  peer.send(JSON.stringify({ topic, data }))
}

/** Sends the current state first, so a late subscriber never misses where things are. */
function snapshot(topic: string): unknown {
  const [kind, id] = topic.split(':')
  if (kind === 'job') return useJobs().get(Number(id))
  return null
}

/**
 * One authenticated socket per tab. The browser subscribes to topics (`job:<id>` now,
 * console streams later) and gets `{ topic, data }` messages back.
 */
export default defineWebSocketHandler({
  async upgrade(request) {
    const session = await getUserSession(request)
    if (!session.user || session.mustEnrolPasskey) {
      return new Response('Sign in first.', { status: 401 })
    }
  },
  open(peer) {
    subscriptions.set(peer.id, new Map())
  },
  message(peer, message) {
    const parsed = ClientMessage.safeParse(safeJson(message.text()))
    if (!parsed.success) return send(peer, 'error', 'Unknown message.')
    const subs = subscriptions.get(peer.id)
    if (!subs) return
    const { type, topic } = parsed.data
    if (type === 'unsubscribe') {
      subs.get(topic)?.()
      subs.delete(topic)
      return
    }
    if (subs.has(topic)) return
    subs.set(
      topic,
      useJobs().bus.subscribe(topic, (data) => send(peer, topic, data)),
    )
    send(peer, topic, snapshot(topic))
  },
  close(peer) {
    for (const off of subscriptions.get(peer.id)?.values() ?? []) off()
    subscriptions.delete(peer.id)
  },
})

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
