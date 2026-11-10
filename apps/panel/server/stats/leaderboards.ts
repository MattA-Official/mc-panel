/**
 * Leaderboards and player cards from the daily snapshot. Pure, so the rules (period starts,
 * ties, and that left-out players never appear) are tested in one place. The snapshot
 * already skips and deletes left-out players; they're filtered again here so a race between
 * leaving someone out and a snapshot can't show them.
 */
import {
  BOARDS,
  boardValue,
  type Board,
  type BoardEntry,
  type BoardKey,
  type Period,
  type PlayerCard,
} from '../../shared/leaderboards'
import { dayIn } from './snapshot'

/** Moves a YYYY-MM-DD day by whole days. */
function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The first day a period counts from, in the server's time zone: the Monday of this week or
 * the 1st of this month. Undefined for all time.
 */
export function periodStart(period: Period, tz: string, now: number): string | undefined {
  if (period === 'all') return undefined
  let today: string
  try {
    today = dayIn(tz, now)
  } catch {
    today = dayIn('UTC', now)
  }
  if (period === 'month') return `${today.slice(0, 8)}01`
  // getUTCDay: Sunday is 0. Weeks start on Monday.
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
  return addDays(today, -((weekday + 6) % 7))
}

export interface Totals {
  uuid: string
  stats: Record<string, number>
}

/**
 * Every board, best first, at most `limit` places each. Players with nothing on a board
 * aren't on it. Equal figures share a rank (1, 2, 2, 4), ordered by name.
 */
export function buildBoards(
  totals: Totals[],
  nameOf: (uuid: string) => string,
  leftOut: ReadonlySet<string>,
  limit = 10,
): Board[] {
  const counted = totals.filter((t) => !leftOut.has(t.uuid))
  return BOARDS.map((def) => {
    const ranked = counted
      .map((t) => ({ uuid: t.uuid, name: nameOf(t.uuid), value: boardValue(def, t.stats) }))
      .filter((e) => e.value > 0)
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    const entries: BoardEntry[] = []
    for (let i = 0; i < ranked.length && i < limit; i++) {
      const e = ranked[i]!
      const prev = entries[i - 1]
      const rank = prev && prev.value === e.value ? prev.rank : i + 1
      entries.push({ rank, ...e })
    }
    return { key: def.key, label: def.label, unit: def.unit, entries }
  })
}

export interface SessionSummary {
  uuid: string
  name: string
  firstSeen: number
  lastSeen: number
  sessions: number
  online: boolean
}

/**
 * A card for everyone with sessions or stats, newest visit first; people who only have
 * stats (they played before Flytower kept sessions) come after, by name.
 */
export function buildCards(
  totals: Totals[],
  sessions: SessionSummary[],
  nameOf: (uuid: string) => string,
  leftOut: ReadonlySet<string>,
): PlayerCard[] {
  const stats = new Map(totals.map((t) => [t.uuid, t.stats]))
  const seen = new Map(sessions.map((s) => [s.uuid, s]))
  const uuids = new Set([...seen.keys(), ...stats.keys()])
  const cards: PlayerCard[] = []
  for (const uuid of uuids) {
    if (leftOut.has(uuid)) continue
    const s = seen.get(uuid)
    const kept = stats.get(uuid) ?? {}
    cards.push({
      uuid,
      name: s?.name && s.name !== uuid ? s.name : nameOf(uuid),
      firstSeen: s?.firstSeen ?? null,
      lastSeen: s?.lastSeen ?? null,
      sessions: s?.sessions ?? 0,
      online: s?.online ?? false,
      stats: Object.fromEntries(BOARDS.map((b) => [b.key, boardValue(b, kept)])) as Record<
        BoardKey,
        number
      >,
    })
  }
  return cards.sort(
    (a, b) => (b.lastSeen ?? -Infinity) - (a.lastSeen ?? -Infinity) || a.name.localeCompare(b.name),
  )
}
