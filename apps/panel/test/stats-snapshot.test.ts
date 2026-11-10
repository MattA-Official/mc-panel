import { beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, schema, type Db } from '../server/db'
import { dayIn, KEEP_DAILY_DAYS, pickStats, StatsSnapshot } from '../server/stats/snapshot'

const STEVE = '069a79f4-44e9-4726-a5be-fca90e38aaf5'
const ALEX = '853c80ef-3c37-49fd-aa49-938b674adae6'
const DAY = 86_400_000

const statsFile = (custom: Record<string, number>, mined: Record<string, number> = {}) => ({
  stats: {
    'minecraft:custom': Object.fromEntries(
      Object.entries(custom).map(([k, v]) => [`minecraft:${k}`, v]),
    ),
    'minecraft:mined': Object.fromEntries(
      Object.entries(mined).map(([k, v]) => [`minecraft:${k}`, v]),
    ),
  },
  DataVersion: 4700,
})

let db: Db
let world: string
let clock: number
let snap: StatsSnapshot
let leftOut: Set<string>

beforeEach(() => {
  db = openDb(':memory:')
  world = join(mkdtempSync(join(tmpdir(), 'ft-stats-')), 'world')
  clock = Date.parse('2026-11-10T03:30:00Z')
  leftOut = new Set()
  snap = new StatsSnapshot({
    db,
    worldDir: async () => world,
    include: (_s, uuid) => !leftOut.has(uuid),
    now: () => clock,
  })
})

/** Writes a stats file in the 26.x layout, dated now. */
function write(uuid: string, file: unknown, dir = join(world, 'players', 'stats')) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${uuid}.json`)
  writeFileSync(path, JSON.stringify(file))
  utimesSync(path, clock / 1000, clock / 1000)
}

const rows = () => db.select().from(schema.playerStats).all()

describe('pickStats', () => {
  it('keeps the chosen keys, totals mined blocks and leaves zeroes out', () => {
    expect(
      pickStats(
        statsFile(
          { deaths: 3, play_time: 72_000, walk_one_cm: 12_345, jump: 0, leave_game: 9 },
          { stone: 40, dirt: 2 },
        ),
      ),
    ).toEqual({ deaths: 3, play_time: 72_000, walk_cm: 12_345, blocks_mined: 42 })
  })

  it('reads the old play time name and survives junk', () => {
    expect(pickStats(statsFile({ play_one_minute: 100 }))).toEqual({ play_time: 100 })
    expect(pickStats(null)).toEqual({})
    expect(pickStats({ stats: { 'minecraft:custom': { 'minecraft:deaths': 'x' } } })).toEqual({})
  })
})

describe('dayIn', () => {
  it('gives the date in the server time zone', () => {
    const at = Date.parse('2026-11-10T23:30:00Z')
    expect(dayIn('UTC', at)).toBe('2026-11-10')
    expect(dayIn('Asia/Tokyo', at)).toBe('2026-11-11')
  })
})

describe('StatsSnapshot', () => {
  it('stores a row per player from the 26.x players/stats folder', async () => {
    write(STEVE, statsFile({ deaths: 1 }))
    write(ALEX, statsFile({ deaths: 2 }))
    expect(await snap.take('survival', 'UTC')).toBe(2)
    const sorted = rows().sort((a, b) => a.uuid.localeCompare(b.uuid))
    expect(sorted.map((r) => [r.uuid, r.day, r.stats])).toEqual([
      [STEVE, '2026-11-10', { deaths: 1 }],
      [ALEX, '2026-11-10', { deaths: 2 }],
    ])
  })

  it('falls back to the older stats folder', async () => {
    write(STEVE, statsFile({ deaths: 1 }), join(world, 'stats'))
    expect(await snap.take('survival', 'UTC')).toBe(1)
  })

  it('does nothing when the world has no stats yet', async () => {
    expect(await snap.take('survival', 'UTC')).toBe(0)
  })

  it('skips players whose file has not changed', async () => {
    write(STEVE, statsFile({ deaths: 1 }))
    await snap.take('survival', 'UTC')
    clock += DAY
    expect(await snap.take('survival', 'UTC')).toBe(0)
    // Touched but the kept numbers are the same: still no new row.
    write(STEVE, statsFile({ deaths: 1, leave_game: 4 }))
    expect(await snap.take('survival', 'UTC')).toBe(0)
    write(STEVE, statsFile({ deaths: 2 }))
    expect(await snap.take('survival', 'UTC')).toBe(1)
    expect(rows().map((r) => r.day)).toEqual(['2026-11-10', '2026-11-11'])
  })

  it('leaves out players the include check says no to', async () => {
    write(STEVE, statsFile({ deaths: 1 }))
    write(ALEX, statsFile({ deaths: 1 }))
    leftOut.add(ALEX)
    await snap.take('survival', 'UTC')
    expect(rows().map((r) => r.uuid)).toEqual([STEVE])
  })

  it('ignores files that are not a UUID', async () => {
    write('not-a-uuid', statsFile({ deaths: 1 }))
    expect(await snap.take('survival', 'UTC')).toBe(0)
  })

  it('gives all-time totals and what was gained since a day', async () => {
    for (const [i, deaths] of [1, 4, 6, 10].entries()) {
      clock = Date.parse('2026-11-01T03:30:00Z') + i * 3 * DAY
      write(STEVE, statsFile({ deaths, jump: 5 }))
      await snap.take('survival', 'UTC')
    }
    // Rows on 1, 4, 7 and 10 November.
    expect(snap.totals('survival')).toEqual([{ uuid: STEVE, stats: { deaths: 10, jumps: 5 } }])
    expect(snap.totals('survival', '2026-11-05')).toEqual([{ uuid: STEVE, stats: { deaths: 6 } }])
    // Nobody played after the 10th.
    expect(snap.totals('survival', '2026-11-11')).toEqual([])
    // Someone new this period counts from nothing.
    write(ALEX, statsFile({ deaths: 2 }))
    await snap.take('survival', 'UTC')
    expect(snap.totals('survival', '2026-11-09')).toContainEqual({
      uuid: ALEX,
      stats: { deaths: 2 },
    })
  })

  it('counts everything as new after the stats were reset by a new world', async () => {
    write(STEVE, statsFile({ deaths: 50 }))
    await snap.take('survival', 'UTC')
    clock += 2 * DAY
    write(STEVE, statsFile({ deaths: 3 }))
    await snap.take('survival', 'UTC')
    expect(snap.totals('survival', '2026-11-11')).toEqual([{ uuid: STEVE, stats: { deaths: 3 } }])
  })

  it('thins rows older than 90 days to the last one in each week', async () => {
    const start = Date.parse('2026-06-01T03:30:00Z') // a Monday
    for (let i = 0; i < 14; i++) {
      clock = start + i * DAY
      write(STEVE, statsFile({ deaths: i + 1 }))
      await snap.take('survival', 'UTC')
    }
    clock = start + (KEEP_DAILY_DAYS + 30) * DAY
    snap.thin('survival', 'UTC')
    expect(rows().map((r) => r.day)).toEqual(['2026-06-07', '2026-06-14'])
    // Recent rows stay daily.
    expect(snap.totals('survival')[0]!.stats.deaths).toBe(14)
  })

  it('forgets one player or a whole server', async () => {
    write(STEVE, statsFile({ deaths: 1 }))
    write(ALEX, statsFile({ deaths: 1 }))
    await snap.take('survival', 'UTC')
    snap.forget('survival', ALEX)
    expect(rows().map((r) => r.uuid)).toEqual([STEVE])
    snap.forget('survival')
    expect(rows()).toEqual([])
  })
})
