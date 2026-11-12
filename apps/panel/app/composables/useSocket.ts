import { createTopicSocket, type SocketLike } from '../utils/topic-socket'

let shared: ReturnType<typeof createTopicSocket> | null = null

function hub() {
  shared ??= createTopicSocket({
    open: () => {
      const url = new URL('/api/ws', location.href)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      return new WebSocket(url) as unknown as SocketLike
    },
  })
  return shared
}

/**
 * Subscribes to a topic on the panel's one shared WebSocket for as long as the calling
 * component lives. The first message is always the topic's current state.
 */
export function useTopic<T>(topic: MaybeRefOrGetter<string | null>, onData: (data: T) => void) {
  let current: string | null = null
  const handler = (d: unknown) => onData(d as T)

  function stop() {
    if (!current) return
    hub().unsubscribe(current, handler)
    current = null
  }

  watch(
    () => toValue(topic),
    (t) => {
      stop()
      if (t) {
        current = t
        hub().subscribe(t, handler)
      }
    },
    { immediate: true },
  )
  onScopeDispose(stop)
}
