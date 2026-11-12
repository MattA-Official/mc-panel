import { beforeEach, describe, expect, it } from 'bun:test'
import { createTopicSocket, type SocketLike } from '../app/utils/topic-socket'

class FakeSocket implements SocketLike {
  readyState = 0
  sent: string[] = []
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  drop() {
    this.readyState = 3
    this.onclose?.({})
  }
  message(topic: string, data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ topic, data }) })
  }
}

describe('the shared topic socket', () => {
  let sockets: FakeSocket[]
  let timers: (() => void)[]
  let hub: ReturnType<typeof createTopicSocket>

  beforeEach(() => {
    sockets = []
    timers = []
    hub = createTopicSocket({
      open: () => {
        const s = new FakeSocket()
        sockets.push(s)
        return s
      },
      setTimer: (fn) => timers.push(fn),
    })
  })

  it('opens one socket for every topic, and subscribes once it is open', () => {
    hub.subscribe('console:a', () => {})
    hub.subscribe('status', () => {})
    expect(sockets).toHaveLength(1)
    sockets[0]!.open()
    expect(sockets[0]!.sent.map((m) => JSON.parse(m).topic)).toEqual(['console:a', 'status'])
  })

  it('reconnects once when a page subscribes while a reconnect is waiting', () => {
    const got: unknown[] = []
    hub.subscribe('console:a', (d) => got.push(d))
    sockets[0]!.open()
    sockets[0]!.drop()
    // A component mounting during the back-off doesn't open a socket of its own.
    hub.subscribe('status', () => {})
    expect(sockets).toHaveLength(1)
    expect(timers).toHaveLength(1)
    timers[0]!()
    expect(sockets).toHaveLength(2)
    sockets[1]!.open()
    sockets[1]!.message('console:a', 'line')
    expect(got).toEqual(['line'])
  })

  it('ignores a socket that has been replaced', () => {
    const got: unknown[] = []
    hub.subscribe('console:a', (d) => got.push(d))
    const first = sockets[0]!
    first.open()
    first.drop()
    timers[0]!()
    sockets[1]!.open()
    first.message('console:a', 'late')
    first.onclose?.({})
    expect(got).toEqual([])
    expect(timers).toHaveLength(1)
  })

  it("doesn't reconnect when nothing is subscribed any more", () => {
    const h = () => {}
    hub.subscribe('status', h)
    sockets[0]!.open()
    hub.unsubscribe('status', h)
    expect(JSON.parse(sockets[0]!.sent.at(-1)!)).toEqual({ type: 'unsubscribe', topic: 'status' })
    sockets[0]!.drop()
    expect(timers).toHaveLength(0)
  })
})
