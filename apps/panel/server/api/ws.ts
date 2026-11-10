import type { Peer } from 'crossws'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '../db'
import { ON_OPEN_AFTER_MS } from '../update-checks'

const Topic = z
  .string()
  .regex(/^(job:\d+|servers|health|updates|(console|schedules):[a-z][a-z0-9-]{1,30})$/)
const ClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), topic: Topic }),
  z.object({ type: z.literal('unsubscribe'), topic: z.string().max(64) }),
])

const subscriptions = new Map<string, Map<string, () => void>>()

const send = (peer: Peer, topic: string, data: unknown) => {
  peer.send(JSON.stringify({ topic, data }))
}

/**
 * Wires a topic to its source. Each source sends its current state first, so a late or
 * reconnecting subscriber never misses where things are.
 */
function attach(topic: string, emit: (data: unknown) => void): () => void {
  if (topic === 'servers') return useStatus().watch(emit)
  if (topic === 'health') {
    return useCrashes().watch(emit, () =>
      useDb()
        .select({ name: schema.servers.name })
        .from(schema.servers)
        .all()
        .map((r) => r.name),
    )
  }
  if (topic === 'updates') {
    // Opening the panel checks again if the last check is over an hour old.
    const off = useUpdates().watch(emit)
    useUpdates().maybeCheck(ON_OPEN_AFTER_MS)
    return off
  }
  if (topic.startsWith('console:')) {
    const name = topic.slice('console:'.length)
    const exists = useDb()
      .select({ name: schema.servers.name })
      .from(schema.servers)
      .where(eq(schema.servers.name, name))
      .get()
    if (!exists) return () => {}
    return useConsole().watch(name, emit)
  }
  if (topic.startsWith('schedules:')) {
    const name = topic.slice('schedules:'.length)
    const off = useJobs().bus.subscribe(topic, emit)
    emit(useSchedules().view(name))
    return off
  }
  const off = useJobs().bus.subscribe(topic, emit)
  emit(useJobs().get(Number(topic.slice('job:'.length))))
  return off
}

/**
 * One authenticated socket per tab. The browser subscribes to topics (`job:<id>`,
 * `servers`, `health`, `updates`, `console:<name>`, `schedules:<name>`) and gets `{ topic, data }`
 * messages back.
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
      attach(topic, (data) => send(peer, topic, data)),
    )
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
