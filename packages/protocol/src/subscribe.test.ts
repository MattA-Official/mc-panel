/**
 * The subscription client against a small fake agent, and, when FLYTOWER_AGENT_TESTING names
 * a `flytower-agent-testing` binary (`cargo build --features testing`), against the real Rust
 * agent too, including a restart in the middle of a subscription.
 */
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import type { Socket, Subprocess, UnixSocketListener } from 'bun'
import { callAgent } from './client.ts'
import { encode, lineSplitter } from './framing.ts'
import { AgentStreams, type SubscriptionEnd } from './subscribe.ts'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((c) => c()))

const socketPath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'flytower-sub-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return join(dir, 'agent.sock')
}

const until = async (check: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting')
    await Bun.sleep(5)
  }
}

type Msg = Record<string, unknown>

/** A fake agent: `onMessage` answers each line; `received` keeps every one. */
function fakeAgent(path: string, onMessage: (m: Msg, reply: (f: unknown) => void) => void) {
  const received: Msg[] = []
  const sockets = new Set<Socket<unknown>>()
  let listener: UnixSocketListener<unknown> | undefined
  const start = () => {
    listener = Bun.listen({
      unix: path,
      socket: {
        open(s) {
          sockets.add(s)
          const feed = lineSplitter(
            (line) => {
              const m = JSON.parse(line) as Msg
              received.push(m)
              onMessage(m, (f) => s.write(encode(f)))
            },
            () => s.end(),
          )
          ;(s as Socket<unknown> & { feed?: typeof feed }).feed = feed
        },
        data(s, chunk) {
          ;(s as Socket<unknown> & { feed: (c: Uint8Array) => void }).feed(chunk)
        },
        close(s) {
          sockets.delete(s)
        },
      },
    })
  }
  start()
  const stop = () => {
    for (const s of sockets) s.end()
    listener?.stop(true)
    rmSync(path, { force: true })
  }
  cleanups.push(stop)
  return { received, sockets, stop, start }
}

const ticksAgent = (path: string) =>
  fakeAgent(path, (m, reply) => {
    if (m.subscribe === 'testing.ticks') {
      reply({ id: m.id, ok: true, result: {} })
      reply({ id: m.id, event: { n: 1 } })
      reply({ id: m.id, skipped: 4 })
      reply({ id: m.id, event: { n: 6 } })
    } else if (m.cancel) {
      reply({ id: m.id, end: true, reason: 'cancelled' })
    }
  })

describe('AgentStreams', () => {
  it('starts, streams and reports skips', async () => {
    const path = socketPath()
    ticksAgent(path)
    const streams = new AgentStreams({ socketPath: path })
    cleanups.push(() => streams.close())
    const events: number[] = []
    const starts: boolean[] = []
    let skipped = 0
    streams.subscribe(
      'testing.ticks',
      { count: 10, intervalMs: 0 },
      {
        onStart: (_r, again) => starts.push(again),
        onEvent: (e) => events.push(e.n),
        onSkipped: (n) => (skipped += n),
      },
    )
    await until(() => events.length === 2)
    expect({ events, starts, skipped }).toEqual({ events: [1, 6], starts: [false], skipped: 4 })
  })

  it('subscribes again after the agent restarts, saying so', async () => {
    const path = socketPath()
    const agent = ticksAgent(path)
    const streams = new AgentStreams({ socketPath: path, minBackoffMs: 10 })
    cleanups.push(() => streams.close())
    const starts: boolean[] = []
    streams.subscribe(
      'testing.ticks',
      { count: 10, intervalMs: 0 },
      { onStart: (_r, again) => starts.push(again), onEvent: () => {} },
    )
    await until(() => starts.length === 1)
    agent.stop()
    await Bun.sleep(50)
    agent.start()
    await until(() => starts.length === 2)
    expect(starts).toEqual([false, true])
    // The same subscription, under the same id, on the new connection.
    const subs = agent.received.filter((m) => m.subscribe)
    expect(subs).toHaveLength(2)
    expect(subs[0]!.id).toBe(subs[1]!.id)
  })

  it('cancels on close and calls nothing after', async () => {
    const path = socketPath()
    const agent = ticksAgent(path)
    const streams = new AgentStreams({ socketPath: path })
    const ends: SubscriptionEnd[] = []
    const sub = streams.subscribe(
      'testing.ticks',
      { count: 10, intervalMs: 0 },
      { onEvent: () => {}, onEnd: (e) => ends.push(e) },
    )
    const other = streams.subscribe(
      'testing.ticks',
      { count: 10, intervalMs: 0 },
      { onEvent: () => {} },
    )
    await until(() => agent.received.filter((m) => m.subscribe).length === 2)
    sub.close()
    await until(() => agent.received.some((m) => m.cancel === true))
    expect(ends).toEqual([])
    expect(streams.size).toBe(1)
    // The last one closing closes the connection.
    other.close()
    await until(() => agent.sockets.size === 0)
  })

  it('gives up on a refused subscription', async () => {
    const path = socketPath()
    const agent = fakeAgent(path, (m, reply) =>
      reply({ id: m.id, ok: false, error: { code: 'unknown_verb', message: 'unknown' } }),
    )
    const streams = new AgentStreams({ socketPath: path, minBackoffMs: 10 })
    cleanups.push(() => streams.close())
    const ends: SubscriptionEnd[] = []
    streams.subscribe(
      'testing.ticks',
      { count: 1, intervalMs: 0 },
      { onEvent: () => {}, onEnd: (e) => ends.push(e) },
    )
    await until(() => ends.length === 1)
    expect(ends[0]).toEqual({ reason: 'refused', code: 'unknown_verb', message: 'unknown' })
    await Bun.sleep(50)
    expect(agent.received).toHaveLength(1)
  })

  it('gives up when the agent speaks protocol 1 only', async () => {
    const path = socketPath()
    // What the Bun agent answers to a line it can't read as a request.
    fakeAgent(path, (_m, reply) =>
      reply({
        id: 'unknown',
        ok: false,
        error: { code: 'bad_request', message: 'not a valid request envelope' },
      }),
    )
    const streams = new AgentStreams({ socketPath: path, minBackoffMs: 10 })
    cleanups.push(() => streams.close())
    const ends: SubscriptionEnd[] = []
    streams.subscribe(
      'testing.ticks',
      { count: 1, intervalMs: 0 },
      { onEvent: () => {}, onEnd: (e) => ends.push(e) },
    )
    await until(() => ends.length === 1)
    expect(ends[0]).toMatchObject({ reason: 'refused', code: 'bad_request' })
    expect(streams.size).toBe(0)
  })

  it('reconnects when the agent goes quiet', async () => {
    const path = socketPath()
    const agent = fakeAgent(path, (m, reply) => {
      if (m.subscribe) reply({ id: m.id, ok: true, result: {} })
    })
    const streams = new AgentStreams({ socketPath: path, minBackoffMs: 10, deadAfterMs: 100 })
    cleanups.push(() => streams.close())
    const starts: boolean[] = []
    streams.subscribe(
      'testing.ticks',
      { count: 1, intervalMs: 0 },
      { onStart: (_r, again) => starts.push(again), onEvent: () => {} },
    )
    await until(() => starts.length === 2)
    expect(starts).toEqual([false, true])
    expect(agent.received.length).toBeGreaterThanOrEqual(2)
  })

  it('refuses bad params before sending', () => {
    const streams = new AgentStreams({ socketPath: '/nonexistent' })
    expect(() =>
      streams.subscribe('testing.ticks', { count: 0, intervalMs: 0 }, { onEvent: () => {} }),
    ).toThrow()
    expect(streams.size).toBe(0)
  })
})

const binary = process.env.FLYTOWER_AGENT_TESTING

describe.skipIf(!binary)('against the real Rust agent', () => {
  const run = (path: string): Subprocess => {
    const proc = Bun.spawn([binary!, path], { stdout: 'ignore', stderr: 'inherit' })
    cleanups.push(() => proc.kill())
    return proc
  }
  /** Asks until the new agent answers. */
  const ready = async (path: string) => {
    for (let i = 0; ; i++) {
      try {
        return await callAgent('agent.hello', {}, { socketPath: path, timeoutMs: 1000 })
      } catch (e) {
        if (i > 100) throw e
        await Bun.sleep(20)
      }
    }
  }

  it('says hello with protocol 2', async () => {
    const path = socketPath()
    run(path)
    expect(await ready(path)).toMatchObject({
      kind: 'rust',
      protocols: [1, 2],
      subscriptions: ['log.follow', 'testing.ticks'],
    })
  })

  it('streams ticks to the end', async () => {
    const path = socketPath()
    run(path)
    await ready(path)
    const streams = new AgentStreams({ socketPath: path })
    cleanups.push(() => streams.close())
    const events: number[] = []
    const ends: SubscriptionEnd[] = []
    streams.subscribe(
      'testing.ticks',
      { count: 5, intervalMs: 10 },
      { onEvent: (e) => events.push(e.n), onEnd: (e) => ends.push(e) },
    )
    await until(() => ends.length === 1)
    expect(events).toEqual([1, 2, 3, 4, 5])
    expect(ends).toEqual([{ reason: 'finished' }])
  })

  it('survives an agent restart and cancels cleanly', async () => {
    const path = socketPath()
    const first = run(path)
    await ready(path)
    const streams = new AgentStreams({ socketPath: path, minBackoffMs: 20 })
    cleanups.push(() => streams.close())
    const starts: boolean[] = []
    const events: number[] = []
    const ends: SubscriptionEnd[] = []
    let after = 0
    const sub = streams.subscribe(
      'testing.ticks',
      { count: 100_000, intervalMs: 20 },
      {
        onStart: (_r, again) => {
          starts.push(again)
          after = events.length
        },
        onEvent: (e) => events.push(e.n),
        onEnd: (e) => ends.push(e),
      },
    )
    await until(() => events.length >= 2)
    first.kill()
    await first.exited
    run(path)
    await until(() => starts.length === 2)
    expect(starts).toEqual([false, true])
    // A fresh agent counts from 1 again.
    await until(() => events.length > after)
    expect(events[after]).toBe(1)
    sub.close()
    const count = events.length
    await Bun.sleep(100)
    expect(events.length).toBeLessThanOrEqual(count + 1)
    expect(ends).toEqual([])
    expect(streams.size).toBe(0)
  })

  it('follows a log through rotation until the server is deleted', async () => {
    const path = socketPath()
    run(path)
    await ready(path)
    // The test build keeps its servers beside its socket.
    const server = join(dirname(path), 'servers', 'survival')
    mkdirSync(join(server, 'logs'), { recursive: true })
    const log = join(server, 'logs', 'latest.log')
    appendFileSync(log, 'one\ntwo\n')
    const streams = new AgentStreams({ socketPath: path })
    cleanups.push(() => streams.close())
    const seed: string[] = []
    const lines: string[] = []
    const ends: SubscriptionEnd[] = []
    streams.subscribe(
      'log.follow',
      { server: 'survival', seedBytes: 1024 },
      {
        onEvent: (e) => {
          if ('seed' in e) seed.push(...e.seed)
          if ('lines' in e) lines.push(...e.lines)
        },
        onEnd: (e) => ends.push(e),
      },
    )
    await until(() => seed.length === 2)
    expect(seed).toEqual(['one', 'two'])
    appendFileSync(log, 'three\n')
    await until(() => lines.length === 1)
    renameSync(log, join(server, 'logs', '2026-11-14-1.log'))
    appendFileSync(log, 'four\n')
    await until(() => lines.length === 2)
    expect(lines).toEqual(['three', 'four'])
    rmSync(server, { recursive: true })
    await until(() => ends.length === 1)
    expect(ends).toEqual([{ reason: 'finished', message: 'the server was deleted' }])
  })

  it('refuses to follow a server that does not exist', async () => {
    const path = socketPath()
    run(path)
    await ready(path)
    const streams = new AgentStreams({ socketPath: path })
    cleanups.push(() => streams.close())
    const ends: SubscriptionEnd[] = []
    streams.subscribe(
      'log.follow',
      { server: 'ghost', seedBytes: 0 },
      { onEvent: () => {}, onEnd: (e) => ends.push(e) },
    )
    await until(() => ends.length === 1)
    expect(ends[0]).toMatchObject({ reason: 'refused', code: 'not_found' })
  })
})
