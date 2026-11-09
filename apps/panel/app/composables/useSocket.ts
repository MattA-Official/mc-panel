type Handler = (data: unknown) => void

let socket: WebSocket | null = null
let retry = 0
const handlers = new Map<string, Set<Handler>>()

function connect() {
  const url = new URL('/api/ws', location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  socket = new WebSocket(url)
  socket.onopen = () => {
    retry = 0
    for (const topic of handlers.keys()) socket!.send(JSON.stringify({ type: 'subscribe', topic }))
  }
  socket.onmessage = (e) => {
    const { topic, data } = JSON.parse(e.data as string) as { topic: string; data: unknown }
    for (const h of handlers.get(topic) ?? []) h(data)
  }
  socket.onclose = () => {
    socket = null
    if (handlers.size === 0) return
    // Back off to 10 s; resubscribing replays a snapshot, so nothing is lost.
    setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++))
  }
}

/**
 * Subscribes to a topic on the panel's one shared WebSocket for as long as the calling
 * component lives. The first message is always the topic's current state.
 */
export function useTopic<T>(topic: MaybeRefOrGetter<string | null>, onData: (data: T) => void) {
  let current: string | null = null
  const handler: Handler = (d) => onData(d as T)

  function stop() {
    if (!current) return
    const set = handlers.get(current)
    set?.delete(handler)
    if (set && set.size === 0) {
      handlers.delete(current)
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'unsubscribe', topic: current }))
      }
    }
    current = null
  }

  function start(t: string) {
    current = t
    let set = handlers.get(t)
    if (!set) {
      handlers.set(t, (set = new Set()))
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'subscribe', topic: t }))
      }
    }
    set.add(handler)
    if (!socket) connect()
  }

  watch(
    () => toValue(topic),
    (t) => {
      stop()
      if (t) start(t)
    },
    { immediate: true },
  )
  onScopeDispose(stop)
}
