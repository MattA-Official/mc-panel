/**
 * The leaderboards drawn from the daily stats snapshot: which stats each one adds up, the
 * periods they cover and how their figures read. Shared by the Stats tab, the server that
 * builds them and (later) the public page and Discord.
 */

export const PERIODS = ['all', 'month', 'week'] as const
export type Period = (typeof PERIODS)[number]

export const PERIOD_LABELS: Record<Period, string> = {
  all: 'All time',
  month: 'This month',
  week: 'This week',
}

/** How a board's figure reads: ticks as hours, centimetres as km, or a plain count. */
export type StatUnit = 'time' | 'distance' | 'count'

export interface BoardDef {
  key: string
  label: string
  /** Snapshot keys (see STAT_KEYS) added together for the figure. */
  stats: string[]
  unit: StatUnit
}

export const BOARDS = [
  {
    key: 'playtime',
    label: 'Playtime',
    stats: ['play_time'],
    unit: 'time',
  },
  { key: 'deaths', label: 'Deaths', stats: ['deaths'], unit: 'count' },
  {
    key: 'mob_kills',
    label: 'Mob kills',
    stats: ['mob_kills'],
    unit: 'count',
  },
  {
    key: 'distance',
    label: 'Distance travelled',
    stats: ['walk_cm', 'sprint_cm', 'swim_cm', 'fly_cm', 'boat_cm', 'horse_cm', 'minecart_cm'],
    unit: 'distance',
  },
  {
    key: 'blocks_mined',
    label: 'Blocks mined',
    stats: ['blocks_mined'],
    unit: 'count',
  },
] as const satisfies readonly BoardDef[]

export type BoardKey = (typeof BOARDS)[number]['key']

export const BOARD_KEYS = BOARDS.map((b) => b.key) as BoardKey[]

export function findBoard(key: string): BoardDef | undefined {
  return BOARDS.find((b) => b.key === key)
}

/** A board's figure from one player's kept stats. */
export function boardValue(board: BoardDef, stats: Record<string, number>): number {
  let sum = 0
  for (const k of board.stats) sum += stats[k] ?? 0
  return sum
}

const TICKS_PER_MINUTE = 20 * 60

/** A figure as people read it: "12 h 30 m", "4.2 km", "1,234". */
export function formatStat(unit: StatUnit, value: number): string {
  switch (unit) {
    case 'time': {
      const minutes = Math.floor(value / TICKS_PER_MINUTE)
      if (minutes < 60) return `${minutes} m`
      const h = Math.floor(minutes / 60)
      const m = minutes % 60
      return m ? `${h.toLocaleString('en-GB')} h ${m} m` : `${h.toLocaleString('en-GB')} h`
    }
    case 'distance': {
      const metres = value / 100
      if (metres < 1000) return `${Math.round(metres).toLocaleString('en-GB')} m`
      const km = metres / 1000
      return `${km.toLocaleString('en-GB', { maximumFractionDigits: km < 100 ? 1 : 0 })} km`
    }
    case 'count':
      return Math.round(value).toLocaleString('en-GB')
  }
}

/** One place on a board. Players with the same figure share a rank. */
export interface BoardEntry {
  rank: number
  uuid: string
  name: string
  value: number
}

export interface Board {
  key: BoardKey
  label: string
  unit: StatUnit
  entries: BoardEntry[]
}

/** A player's card on the Stats tab. */
export interface PlayerCard {
  uuid: string
  name: string
  /** From sessions; null for someone who only played before Flytower kept sessions. */
  firstSeen: number | null
  lastSeen: number | null
  sessions: number
  online: boolean
  /** Each board's figure for the chosen period. */
  stats: Record<BoardKey, number>
}

/** What the Stats tab shows for a period. */
export interface StatsOverview {
  /** Whether new stats are being kept (the switch in Settings). */
  enabled: boolean
  period: Period
  /** The first day the period counts from (YYYY-MM-DD), or null for all time. */
  since: string | null
  /** When the newest snapshot was read, or null before the first one. */
  updatedAt: number | null
  boards: Board[]
  players: PlayerCard[]
}
