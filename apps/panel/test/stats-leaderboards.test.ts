import { describe, expect, it } from 'bun:test'
import { buildBoards, buildCards, periodStart } from '../server/stats/leaderboards'
import { boardValue, findBoard, formatStat } from '../shared/leaderboards'

const STEVE = '069a79f4-44e9-4726-a5be-fca90e38aaf5'
const ALEX = '853c80ef-3c37-49fd-aa49-938b674adae6'
const NOTCH = '069a79f4-44e9-4726-a5be-fca90e38aaf6'
const names: Record<string, string> = { [STEVE]: 'Steve', [ALEX]: 'Alex', [NOTCH]: 'Notch' }
const nameOf = (u: string) => names[u] ?? u
const none = new Set<string>()

const board = (boards: ReturnType<typeof buildBoards>, key: string) =>
  boards.find((b) => b.key === key)!

describe('periodStart', () => {
  // Tuesday 10 November 2026.
  const now = Date.parse('2026-11-10T12:00:00Z')

  it('is undefined for all time', () => {
    expect(periodStart('all', 'UTC', now)).toBeUndefined()
  })

  it('starts the week on Monday and the month on the 1st', () => {
    expect(periodStart('week', 'UTC', now)).toBe('2026-11-09')
    expect(periodStart('month', 'UTC', now)).toBe('2026-11-01')
  })

  it('counts a Sunday as the end of the week, not the start', () => {
    expect(periodStart('week', 'UTC', Date.parse('2026-11-15T12:00:00Z'))).toBe('2026-11-09')
    expect(periodStart('week', 'UTC', Date.parse('2026-11-16T00:30:00Z'))).toBe('2026-11-16')
  })

  it("uses the server's time zone", () => {
    // 23:30 on Sunday 31 Jan in UTC is already Monday 1 Feb in Auckland.
    const at = Date.parse('2027-01-31T23:30:00Z')
    expect(periodStart('week', 'UTC', at)).toBe('2027-01-25')
    expect(periodStart('week', 'Pacific/Auckland', at)).toBe('2027-02-01')
    expect(periodStart('month', 'Pacific/Auckland', at)).toBe('2027-02-01')
  })

  it('falls back to UTC for a zone it does not know', () => {
    expect(periodStart('month', 'Not/AZone', now)).toBe('2026-11-01')
  })
})

describe('buildBoards', () => {
  const totals = [
    { uuid: STEVE, stats: { deaths: 3, walk_cm: 50_000, fly_cm: 150_000, play_time: 72_000 } },
    { uuid: ALEX, stats: { deaths: 5, sprint_cm: 10_000, blocks_mined: 40 } },
    { uuid: NOTCH, stats: { deaths: 3, mob_kills: 2 } },
  ]

  it('ranks best first and leaves out players with nothing', () => {
    const b = buildBoards(totals, nameOf, none)
    expect(board(b, 'playtime').entries.map((e) => e.name)).toEqual(['Steve'])
    expect(board(b, 'distance').entries.map((e) => [e.name, e.value])).toEqual([
      ['Steve', 200_000],
      ['Alex', 10_000],
    ])
    expect(board(b, 'blocks_mined').entries.map((e) => e.name)).toEqual(['Alex'])
  })

  it('gives equal figures the same rank, ordered by name', () => {
    const deaths = board(buildBoards(totals, nameOf, none), 'deaths').entries
    expect(deaths.map((e) => [e.rank, e.name])).toEqual([
      [1, 'Alex'],
      [2, 'Notch'],
      [2, 'Steve'],
    ])
  })

  it('stops at the limit', () => {
    expect(board(buildBoards(totals, nameOf, none, 2), 'deaths').entries).toHaveLength(2)
  })

  it('never shows a left-out player', () => {
    const b = buildBoards(totals, nameOf, new Set([STEVE]))
    for (const x of b) expect(x.entries.some((e) => e.uuid === STEVE)).toBe(false)
    expect(board(b, 'deaths').entries.map((e) => [e.rank, e.name])).toEqual([
      [1, 'Alex'],
      [2, 'Notch'],
    ])
  })
})

describe('buildCards', () => {
  const sessions = [
    { uuid: STEVE, name: 'Steve', firstSeen: 1, lastSeen: 50, sessions: 4, online: true },
    { uuid: ALEX, name: 'Alex', firstSeen: 2, lastSeen: 90, sessions: 1, online: false },
  ]
  const totals = [
    { uuid: STEVE, stats: { deaths: 2 } },
    { uuid: NOTCH, stats: { blocks_mined: 9 } },
  ]

  it('has a card for anyone with visits or stats, latest visit first', () => {
    const cards = buildCards(totals, sessions, nameOf, none)
    expect(cards.map((c) => c.name)).toEqual(['Alex', 'Steve', 'Notch'])
    expect(cards[1]!.stats.deaths).toBe(2)
    expect(cards[1]!.online).toBe(true)
    expect(cards[0]!.stats.deaths).toBe(0)
    expect(cards[2]).toMatchObject({ firstSeen: null, lastSeen: null, sessions: 0 })
    expect(cards[2]!.stats.blocks_mined).toBe(9)
  })

  it('never shows a left-out player', () => {
    const cards = buildCards(totals, sessions, nameOf, new Set([STEVE, NOTCH]))
    expect(cards.map((c) => c.name)).toEqual(['Alex'])
  })
})

describe('formatStat', () => {
  it('reads ticks as hours and minutes', () => {
    expect(formatStat('time', 0)).toBe('0 m')
    expect(formatStat('time', 20 * 60 * 45)).toBe('45 m')
    expect(formatStat('time', 20 * 3600 * 2)).toBe('2 h')
    expect(formatStat('time', 20 * 60 * 150)).toBe('2 h 30 m')
    expect(formatStat('time', 20 * 3600 * 1200)).toBe('1,200 h')
  })

  it('reads centimetres as metres or km', () => {
    expect(formatStat('distance', 12_345)).toBe('123 m')
    expect(formatStat('distance', 420_000)).toBe('4.2 km')
    expect(formatStat('distance', 123_456_789)).toBe('1,235 km')
  })

  it('reads counts with separators', () => {
    expect(formatStat('count', 12345)).toBe('12,345')
  })

  it('adds up every way of travelling for distance', () => {
    expect(boardValue(findBoard('distance')!, { walk_cm: 1, boat_cm: 2, deaths: 9 })).toBe(3)
  })
})
