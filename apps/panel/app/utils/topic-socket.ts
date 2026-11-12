/**
 * The panel's one shared WebSocket, carrying every topic a page subscribes to. Kept free of
 * Vue so it can be tested on its own; `useTopic` wraps it for components.
 */
type Handler = (data: unknown) => void

/** The parts of a WebSocket this uses. */
export interface SocketLike {
  readyState: number
  send(data: string): void
  close(): void
  onopen: ((e: unknown) => void) | null
  onmessage: ((e: { data: unknown }) => void) | null
  onclose: ((e: unknown) => void) | null
}

export interface TopicSocketDeps {
  open: () => SocketLike
  setTimer?: (fn: () => void, ms: number) => unknown
}

const OPEN = 1

export function createTopicSocket(deps: TopicSocketDeps) {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  let socket: SocketLike | null = null
  let reconnect: unknown = null
  let retry = 0
  const handlers = new Map<string, Set<Handler>>()

  const send = (msg: { type: 'subscribe' | 'unsubscribe'; topic: string }) => {
    if (socket?.readyState === OPEN) socket.send(JSON.stringify(msg))
  }

  /** Opens the socket, unless one is connecting, open, or already due to reconnect. */
  function connect() {
    if (socket || reconnect !== null) return
    const ws = deps.open()
    socket = ws
    ws.onopen = () => {
      if (socket !== ws) return
      retry = 0
      for (const topic of handlers.keys()) ws.send(JSON.stringify({ type: 'subscribe', topic }))
    }
    ws.onmessage = (e) => {
      // A socket that's been replaced says nothing more, so nothing is handled twice.
      if (socket !== ws) return
      const { topic, data } = JSON.parse(e.data as string) as { topic: string; data: unknown }
      for (const h of handlers.get(topic) ?? []) h(data)
    }
    ws.onclose = () => {
      if (socket !== ws) return
      socket = null
      if (handlers.size === 0) return
      // Back off to 10 s; resubscribing replays a snapshot, so nothing is lost.
      reconnect = setTimer(
        () => {
          reconnect = null
          if (handlers.size) connect()
        },
        Math.min(10_000, 500 * 2 ** retry++),
      )
    }
  }

  return {
    /** Starts handing a topic's messages to `handler`, connecting if need be. */
    subscribe(topic: string, handler: Handler) {
      let set = handlers.get(topic)
      if (!set) {
        handlers.set(topic, (set = new Set()))
        send({ type: 'subscribe', topic })
      }
      set.add(handler)
      connect()
    },
    unsubscribe(topic: string, handler: Handler) {
      const set = handlers.get(topic)
      set?.delete(handler)
      if (set && set.size === 0) {
        handlers.delete(topic)
        send({ type: 'unsubscribe', topic })
      }
    },
  }
}
