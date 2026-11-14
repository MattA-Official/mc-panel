import { describe, expect, it } from 'bun:test'
import { KEEP_LINES, LogStreams, type LogHandlers, type LogSource } from '../server/logs/streams'

/** A source the test drives by hand. */
function fakeSource(kind: LogSource['kind']) {
  const followed = new Map<string, LogHandlers>()
  let stopped = 0
  const source: LogSource = {
    kind,
    follow(server, _seed, h) {
      followed.set(server, h)
      return () => {
        stopped++
        followed.delete(server)
      }
    },
  }
  return { source, followed, stopped: () => stopped }
}

async function until(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms
  while (!check() && Date.now() < end) await Bun.sleep(1)
}

describe('LogStreams', () => {
  it('shares one stream per server and stops it after the last listener', async () => {
    const agent = fakeSource('agent')
    const streams = new LogStreams(async () => agent.source, fakeSource('local').source)
    const a: string[] = []
    const b: string[] = []
    const offA = streams.listen('lobby', { lines: (l) => a.push(...l) })
    const offB = streams.listen('lobby', { lines: (l) => b.push(...l) })
    await until(() => agent.followed.has('lobby'))
    agent.followed.get('lobby')!.lines(['hello'])
    expect(a).toEqual(['hello'])
    expect(b).toEqual(['hello'])
    expect(streams.sources()).toEqual({ lobby: 'agent' })
    offA()
    expect(agent.stopped()).toBe(0)
    offB()
    expect(agent.stopped()).toBe(1)
    expect(streams.recent('lobby')).toEqual([])
  })

  it('marks seed lines, and a fresh seed replaces what was kept', async () => {
    const agent = fakeSource('agent')
    const streams = new LogStreams(async () => agent.source, fakeSource('local').source)
    const seen: [string[], boolean][] = []
    let resets = 0
    streams.listen('lobby', {
      lines: (l, seed) => seen.push([l, seed]),
      reset: () => resets++,
    })
    await until(() => agent.followed.has('lobby'))
    const h = agent.followed.get('lobby')!
    h.seed(['old'], true)
    h.lines(['new'])
    expect(seen).toEqual([
      [['old'], true],
      [['new'], false],
    ])
    expect(streams.recent('lobby')).toEqual(['old', 'new'])
    // The agent restarted: it starts again from the end of the log.
    h.seed(['old', 'new', 'newer'], true)
    expect(resets).toBe(2)
    expect(streams.recent('lobby')).toEqual(['old', 'new', 'newer'])
  })

  it('keeps only the last lines', async () => {
    const agent = fakeSource('agent')
    const streams = new LogStreams(async () => agent.source, fakeSource('local').source)
    streams.listen('lobby', { lines: () => {} })
    await until(() => agent.followed.has('lobby'))
    const lines = Array.from({ length: KEEP_LINES + 10 }, (_, i) => `l${i}`)
    agent.followed.get('lobby')!.lines(lines)
    expect(streams.recent('lobby')).toHaveLength(KEEP_LINES)
    expect(streams.recent('lobby').at(-1)).toBe(`l${KEEP_LINES + 9}`)
  })

  it('falls back to following the file when the agent fails', async () => {
    const agent = fakeSource('agent')
    const local = fakeSource('local')
    let fellBack = 0
    const streams = new LogStreams(
      async () => agent.source,
      local.source,
      () => fellBack++,
    )
    const seen: string[] = []
    streams.listen('lobby', { lines: (l) => seen.push(...l) })
    await until(() => agent.followed.has('lobby'))
    agent.followed.get('lobby')!.failed!('refused')
    expect(fellBack).toBe(1)
    expect(agent.stopped()).toBe(1)
    expect(streams.sources()).toEqual({ lobby: 'local' })
    local.followed.get('lobby')!.lines(['from the file'])
    expect(seen).toEqual(['from the file'])
  })

  it('uses the fallback when choosing a source fails', async () => {
    const local = fakeSource('local')
    const streams = new LogStreams(async () => {
      throw new Error('no agent')
    }, local.source)
    streams.listen('lobby', { lines: () => {} })
    await until(() => local.followed.has('lobby'))
    expect(streams.sources()).toEqual({ lobby: 'local' })
  })
})
