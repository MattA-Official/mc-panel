import { describe, expect, it } from 'bun:test'
import type { AgentCall } from '../server/jobs/runner'
import { StatusWatcher, type StatusMap } from '../server/jobs/status'

function fakeAgent(states: Record<string, string>, opts: { down?: boolean } = {}) {
  const calls: string[] = []
  const agent = (async (_verb: string, params: { server: string }) => {
    calls.push(params.server)
    if (opts.down) throw new Error('ECONNREFUSED')
    return { active: states[params.server] ?? 'inactive', since: null }
  }) as unknown as AgentCall
  return { agent, calls }
}

const tick = () => Bun.sleep(5)

/** Waits until `check` passes, so a slow machine doesn't fail a test on timing alone. */
async function until(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms
  while (!check() && Date.now() < end) await Bun.sleep(2)
}

describe('StatusWatcher', () => {
  it('does not poll with nobody watching', async () => {
    const { agent, calls } = fakeAgent({})
    new StatusWatcher(agent, () => ['a'], 1)
    await Bun.sleep(20)
    expect(calls).toHaveLength(0)
  })

  it('sends the current map to a new watcher, then only changes', async () => {
    const states: Record<string, string> = { a: 'active', b: 'inactive' }
    const { agent } = fakeAgent(states)
    const w = new StatusWatcher(agent, () => ['a', 'b'], 60_000)
    const seen: StatusMap[] = []
    const off = w.watch((m) => seen.push({ ...m }))
    await tick()
    expect(seen.at(-1)).toEqual({ a: 'active', b: 'inactive' })
    const count = seen.length

    await w.poke()
    expect(seen).toHaveLength(count)

    states.b = 'activating'
    await w.poke()
    expect(seen.at(-1)).toEqual({ a: 'active', b: 'activating' })
    off()
  })

  it('stops polling once the last watcher leaves', async () => {
    const { agent, calls } = fakeAgent({ a: 'active' })
    const w = new StatusWatcher(agent, () => ['a'], 2)
    const off = w.watch(() => {})
    await until(() => calls.length > 1)
    off()
    const after = calls.length
    expect(after).toBeGreaterThan(1)
    await Bun.sleep(15)
    expect(calls.length).toBe(after)
  })

  it('reads unknown when the agent is down', async () => {
    const { agent } = fakeAgent({}, { down: true })
    const w = new StatusWatcher(agent, () => ['a'])
    expect(await w.current()).toEqual({ a: 'unknown' })
  })

  it('shares one poll between simultaneous pokes', async () => {
    const { agent, calls } = fakeAgent({ a: 'active' })
    const w = new StatusWatcher(agent, () => ['a'])
    await Promise.all([w.poke(), w.poke(), w.poke()])
    expect(calls).toHaveLength(1)
  })

  it('follows systemd through the agent instead of polling, and tells the crash monitor', async () => {
    const states: Record<string, string> = { a: 'active' }
    let release: (() => void) | null = null
    const verbs: string[] = []
    const polls: Record<string, unknown>[] = []
    const agent = (async (verb: string, params: { server?: string; after?: string | null }) => {
      verbs.push(verb)
      if (verb === 'service.wait') {
        if (params.after === null) return { cursor: 'r:0', changed: ['a'], following: true }
        await new Promise<void>((r) => (release = r))
        return { cursor: 'r:1', changed: ['a'], following: true }
      }
      return { active: states[params.server!], since: null, result: 'success' }
    }) as unknown as AgentCall
    const w = new StatusWatcher(
      agent,
      () => ['a'],
      1,
      (p) => void polls.push(p),
    )
    const seen: StatusMap[] = []
    w.follow({ fallbackMs: 5 })
    w.watch((m) => seen.push({ ...m }))
    await until(() => seen.length > 0 && verbs.filter((v) => v === 'service.wait').length > 1)
    const statusCalls = verbs.filter((v) => v === 'service.status').length
    // Nothing is asked again while systemd is quiet.
    await Bun.sleep(30)
    expect(verbs.filter((v) => v === 'service.status').length).toBe(statusCalls)

    states.a = 'activating'
    release!()
    await until(
      () =>
        seen.at(-1)?.a === 'activating' &&
        (polls.at(-1)?.a as { active?: string } | undefined)?.active === 'activating',
    )
    expect(seen.at(-1)).toEqual({ a: 'activating' })
    expect(polls.at(-1)).toMatchObject({ a: { active: 'activating', result: 'success' } })
    w.unfollow()
    release!()
  })

  it('falls back to polling when the agent cannot follow the journal', async () => {
    let calls = 0
    const agent = (async (verb: string) => {
      if (verb === 'service.wait') return { cursor: '', changed: ['a'], following: false }
      calls++
      return { active: 'active', since: null }
    }) as unknown as AgentCall
    const w = new StatusWatcher(agent, () => ['a'])
    w.follow({ fallbackMs: 5 })
    await until(() => calls > 3)
    w.unfollow()
    expect(calls).toBeGreaterThan(3)
  })
})

describe('StatusWatcher with service.events', () => {
  type Handlers = Parameters<import('../server/jobs/status').StatusEvents>[1]
  function setup(names: string[], opts: { offered?: boolean } = {}) {
    const calls: string[] = []
    const agent = (async (verb: string) => {
      calls.push(verb)
      if (verb === 'service.wait') return new Promise(() => {})
      return { active: 'inactive', since: null }
    }) as unknown as AgentCall
    const subs: { servers: string[]; h: Handlers; closed: boolean }[] = []
    const polls: Record<string, unknown>[] = []
    const w = new StatusWatcher(
      agent,
      () => names,
      60_000,
      (s) => void polls.push(s),
    )
    w.follow({
      events: async (servers, h) => {
        if (opts.offered === false) return null
        const sub = { servers, h, closed: false }
        subs.push(sub)
        return { close: () => void (sub.closed = true) }
      },
    })
    return { w, calls, subs, polls }
  }
  const status = (active: string) => ({ active, since: null }) as never

  it('takes changes from events, with no waiting or polling', async () => {
    const { w, calls, subs, polls } = setup(['a', 'b'])
    await until(() => subs.length === 1)
    expect(subs[0]!.servers).toEqual(['a', 'b'])
    const seen: StatusMap[] = []
    subs[0]!.h.start({ a: status('active') }, false)
    w.watch((m) => seen.push({ ...m }))
    await until(() => seen.length > 0)
    expect(seen.at(-1)).toEqual({ a: 'active', b: 'unknown' })
    expect(w.streaming).toBe(true)

    subs[0]!.h.change('b', status('activating'))
    expect(seen.at(-1)).toEqual({ a: 'active', b: 'activating' })
    // Crash detection hears each change on its own.
    expect(polls.at(-1)).toEqual({ b: status('activating') })
    expect(calls).not.toContain('service.wait')
    w.unfollow()
    expect(subs[0]!.closed).toBe(true)
  })

  it('subscribes again when the servers change', async () => {
    const names = ['a']
    const { w, subs } = setup(names)
    await until(() => subs.length === 1)
    names.push('b')
    await w.poke()
    await until(() => subs.length === 2)
    expect(subs[1]!.servers).toEqual(['a', 'b'])
    expect(subs[0]!.closed).toBe(true)
    w.unfollow()
  })

  it('waits with service.wait when events are not offered', async () => {
    const { w, calls } = setup(['a'], { offered: false })
    await until(() => calls.includes('service.wait'))
    expect(w.streaming).toBe(false)
    w.unfollow()
  })

  it('goes back to waiting when the stream ends', async () => {
    const { w, calls, subs } = setup(['a'])
    await until(() => subs.length === 1)
    subs[0]!.h.end()
    await until(() => calls.includes('service.wait'))
    expect(w.streaming).toBe(false)
    w.unfollow()
  })
})
