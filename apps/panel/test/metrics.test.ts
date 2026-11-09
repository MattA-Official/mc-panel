import { describe, expect, it } from 'bun:test'
import { openDb, schema } from '../server/db'
import {
  MACHINE,
  MetricsSampler,
  parseMeminfo,
  parseProcStat,
  parseTickQuery,
  series,
  type MachineReading,
} from '../server/metrics/sampler'
import type { AgentCall } from '../server/jobs/runner'

describe('metrics parsing', () => {
  it('reads tick time, /proc/stat and /proc/meminfo', () => {
    expect(
      parseTickQuery(
        'The game is running normally\nTarget tick rate: 20.0 per second.\nAverage time per tick: 3.2ms (Target: 50.0ms)',
      ),
    ).toBe(3.2)
    expect(parseTickQuery('Unknown or incomplete command')).toBeNull()
    expect(parseProcStat('cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 2 3 4')).toEqual({
      busy: 150,
      total: 1000,
    })
    expect(
      parseMeminfo('MemTotal:  8192000 kB\nMemFree: 1 kB\nMemAvailable:  4096000 kB\n'),
    ).toEqual({ usedMb: 4000, totalMb: 8000 })
  })
})

function setup() {
  const db = openDb(':memory:')
  let now = new Date('2026-11-09T12:00:10Z')
  let cpuNs = 0
  let active = true
  let busy = 0
  let total = 0
  const agent = (async (verb: string) => {
    if (verb !== 'service.usage') throw new Error(verb)
    return {
      usage: {
        survival: {
          active,
          cpuNs: active ? cpuNs : null,
          memoryBytes: active ? 2 * 2 ** 30 : null,
        },
      },
    }
  }) as unknown as AgentCall
  const machine = async (): Promise<MachineReading> => ({
    cpuBusy: busy,
    cpuTotal: total,
    memUsedMb: 3000,
    memTotalMb: 8000,
    diskUsedMb: 10_000,
    diskTotalMb: 80_000,
  })
  const sampler = new MetricsSampler({
    db,
    agent,
    names: () => ['survival'],
    rcon: async (_s, cmd) =>
      cmd === 'list'
        ? 'There are 3 of a max of 20 players online: a, b, c'
        : 'Average time per tick: 12.5ms (Target: 50.0ms)',
    machine,
    cores: 4,
    now: () => now,
  })
  const advance = (opts: { cores: number; machinePct: number; up?: boolean }) => {
    now = new Date(now.getTime() + 60_000)
    cpuNs += opts.cores * 60e9
    busy += opts.machinePct
    total += 100
    active = opts.up ?? true
  }
  return { db, sampler, advance, now: () => now }
}

describe('MetricsSampler', () => {
  it('samples CPU as a share of the machine, memory, players and tick time', async () => {
    const { db, sampler, advance } = setup()
    await sampler.sample() // primes the CPU counters
    advance({ cores: 1, machinePct: 40 })
    await sampler.sample()
    const rows = db.select().from(schema.metrics).all()
    const last = rows.filter((r) => r.server === 'survival').at(-1)!
    expect(last).toMatchObject({ cpu: 25, memMb: 2048, players: 3, mspt: 12.5 })
    expect(rows.find((r) => r.server === MACHINE && r.cpu !== null)).toMatchObject({
      cpu: 40,
      memMb: 3000,
      diskMb: 10_000,
    })
  })

  it('leaves gaps while a server is stopped, and buckets by range', async () => {
    const { db, sampler, advance, now } = setup()
    await sampler.sample()
    advance({ cores: 1, machinePct: 10 })
    await sampler.sample()
    advance({ cores: 0, machinePct: 10, up: false })
    await sampler.sample()
    advance({ cores: 0, machinePct: 10, up: true })
    await sampler.sample()

    const hour = series(db, 'survival', 'hour', now().getTime())
    expect(hour.points).toHaveLength(60)
    const tail = hour.points.slice(-4).map((p) => p.memMb)
    expect(tail).toEqual([2048, 2048, null, 2048])
    // The first minute after a restart has no CPU figure yet.
    expect(hour.points.at(-1)!.cpu).toBeNull()

    const week = series(db, 'survival', 'week', now().getTime())
    expect(week.points).toHaveLength(336)
    expect(week.points.at(-1)!.players).toBe(3)
  })

  it('drops samples older than a week', async () => {
    const { db, sampler } = setup()
    db.insert(schema.metrics)
      .values([
        { server: 'survival', at: 1000, cpu: 1 },
        { server: 'survival', at: Math.floor(Date.parse('2026-11-09T11:00:00Z') / 1000), cpu: 1 },
      ])
      .run()
    sampler.prune(Math.floor(Date.parse('2026-11-09T12:00:00Z') / 1000))
    expect(db.select().from(schema.metrics).all()).toHaveLength(1)
  })
})
