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
    await Bun.sleep(15)
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

  it('hands every poll to the notifications hook, so quick stops are seen', async () => {
    const states: Record<string, string> = { a: 'active' }
    const { agent } = fakeAgent(states)
    const polls: StatusMap[] = []
    const w = new StatusWatcher(
      agent,
      () => ['a'],
      60_000,
      (m) => polls.push({ ...m }),
    )
    await w.poke()
    states.a = 'inactive'
    await w.poke()
    await w.poke()
    expect(polls).toEqual([{ a: 'active' }, { a: 'inactive' }, { a: 'inactive' }])
  })
})
