/**
 * A daily snapshot of a short list of vanilla stats per player, read from the stats files
 * Minecraft already writes (`<world>/players/stats/<uuid>.json` since 26.1, `<world>/stats/`
 * before). Only players whose file changed since their last row get a new row, so people who
 * didn't play cost nothing. Week and month figures are the difference between the newest row
 * and the newest row before the period began.
 *
 * Kept light on purpose: about 20 numbers, not the thousands of item and block counters a
 * stats file holds.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { and, desc, eq, lt, lte, sql } from 'drizzle-orm'
import { schema, type Db } from '../db'

type StatsFile = { stats?: Record<string, Record<string, unknown> | undefined> }

const custom =
  (...keys: string[]) =>
  (f: StatsFile) => {
    const c = f.stats?.['minecraft:custom'] ?? {}
    for (const k of keys) {
      const v = c[`minecraft:${k}`]
      if (typeof v === 'number') return v
    }
    return 0
  }

const total = (category: string) => (f: StatsFile) => {
  let sum = 0
  for (const v of Object.values(f.stats?.[`minecraft:${category}`] ?? {})) {
    if (typeof v === 'number') sum += v
  }
  return sum
}

/**
 * The stats kept, by our own short key. Distances are in centimetres, play time in ticks and
 * damage in tenths of a heart, as Minecraft counts them.
 */
export const STAT_KEYS = {
  play_time: custom('play_time', 'play_one_minute'),
  deaths: custom('deaths'),
  player_kills: custom('player_kills'),
  mob_kills: custom('mob_kills'),
  walk_cm: custom('walk_one_cm'),
  sprint_cm: custom('sprint_one_cm'),
  swim_cm: custom('swim_one_cm'),
  fly_cm: custom('aviate_one_cm'),
  boat_cm: custom('boat_one_cm'),
  horse_cm: custom('horse_one_cm'),
  minecart_cm: custom('minecart_one_cm'),
  jumps: custom('jump'),
  damage_dealt: custom('damage_dealt'),
  damage_taken: custom('damage_taken'),
  fish_caught: custom('fish_caught'),
  animals_bred: custom('animals_bred'),
  villager_trades: custom('traded_with_villager'),
  times_slept: custom('sleep_in_bed'),
  raids_won: custom('raid_win'),
  blocks_mined: total('mined'),
  items_crafted: total('crafted'),
  items_used: total('used'),
} satisfies Record<string, (f: StatsFile) => number>

export type StatKey = keyof typeof STAT_KEYS

/** The kept stats from a parsed stats file; zeroes are left out to keep rows small. */
export function pickStats(file: unknown): Record<string, number> {
  const f = (file && typeof file === 'object' ? file : {}) as StatsFile
  const out: Record<string, number> = {}
  for (const [key, read] of Object.entries(STAT_KEYS)) {
    const v = read(f)
    if (v) out[key] = v
  }
  return out
}

/** Today's date in a time zone, as YYYY-MM-DD. */
export function dayIn(tz: string, at: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/** Rows older than this many days are thinned to one a week. */
export const KEEP_DAILY_DAYS = 90

const UUID_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i

export interface SnapshotDeps {
  db: Db
  /** The server's world folder (level-name), absolute. */
  worldDir: (server: string) => Promise<string>
  /** Whether this player's stats should be kept; everyone by default. */
  include?: (server: string, uuid: string) => boolean
  now?: () => number
}

export class StatsSnapshot {
  private now: () => number

  constructor(private deps: SnapshotDeps) {
    this.now = deps.now ?? Date.now
  }

  /** The folder Minecraft writes stats files to, or null when there isn't one yet. */
  async statsDir(server: string): Promise<string | null> {
    const world = await this.deps.worldDir(server)
    for (const dir of [join(world, 'players', 'stats'), join(world, 'stats')]) {
      const s = await stat(dir).catch(() => null)
      if (s?.isDirectory()) return dir
    }
    return null
  }

  /** Reads every changed stats file and stores today's row. Returns how many were stored. */
  async take(server: string, tz: string): Promise<number> {
    const dir = await this.statsDir(server)
    if (!dir) return 0
    const now = this.now()
    const day = dayIn(tz, now)
    const files = await readdir(dir).catch(() => [] as string[])
    let stored = 0
    for (const file of files) {
      const m = UUID_FILE.exec(file)
      if (!m) continue
      const uuid = m[1]!.toLowerCase()
      if (this.deps.include && !this.deps.include(server, uuid)) continue
      try {
        const path = join(dir, file)
        const last = this.latest(server, uuid)
        const info = await stat(path)
        if (last && info.mtimeMs <= last.takenAt.getTime()) continue
        const stats = pickStats(JSON.parse(await readFile(path, 'utf8')))
        if (last && sameStats(last.stats, stats)) continue
        this.deps.db
          .insert(schema.playerStats)
          .values({ server, uuid, day, takenAt: new Date(now), stats })
          .onConflictDoUpdate({
            target: [schema.playerStats.server, schema.playerStats.uuid, schema.playerStats.day],
            set: { takenAt: new Date(now), stats },
          })
          .run()
        stored++
      } catch (err) {
        console.error(`[flytower] reading stats for ${uuid} on ${server} failed`, err)
      }
    }
    this.thin(server, tz)
    return stored
  }

  /** Keeps only the last row of each week for rows older than KEEP_DAILY_DAYS. */
  thin(server: string, tz: string) {
    const cutoff = dayIn(tz, this.now() - KEEP_DAILY_DAYS * 86_400_000)
    // strftime('%Y-%W') is the year and week (weeks start on Monday).
    this.deps.db.run(sql`
      DELETE FROM player_stats
      WHERE server = ${server} AND day < ${cutoff}
        AND (uuid, day) NOT IN (
          SELECT uuid, max(day) FROM player_stats
          WHERE server = ${server} AND day < ${cutoff}
          GROUP BY uuid, strftime('%Y-%W', day)
        )
    `)
  }

  /** A player's newest row. */
  latest(server: string, uuid: string, onOrBefore?: string) {
    const p = schema.playerStats
    return (
      this.deps.db
        .select({ day: p.day, takenAt: p.takenAt, stats: p.stats })
        .from(p)
        .where(
          and(
            eq(p.server, server),
            eq(p.uuid, uuid),
            onOrBefore ? lte(p.day, onOrBefore) : undefined,
          ),
        )
        .orderBy(desc(p.day))
        .limit(1)
        .get() ?? null
    )
  }

  /**
   * Each player's stats on a server: all time when `since` is left out, or gained since the
   * start of that day (the newest row minus the newest row before it).
   */
  totals(server: string, since?: string): { uuid: string; stats: Record<string, number> }[] {
    const p = schema.playerStats
    const newest = this.deps.db
      .select({ uuid: p.uuid, stats: p.stats, day: p.day })
      .from(p)
      .where(
        and(
          eq(p.server, server),
          sql`${p.day} = (SELECT max(day) FROM player_stats s WHERE s.server = ${p.server} AND s.uuid = ${p.uuid})`,
        ),
      )
      .all()
    if (!since) return newest.map((r) => ({ uuid: r.uuid, stats: r.stats }))
    const before = new Map(
      this.deps.db
        .select({ uuid: p.uuid, stats: p.stats })
        .from(p)
        .where(
          and(
            eq(p.server, server),
            lt(p.day, since),
            sql`${p.day} = (SELECT max(day) FROM player_stats s WHERE s.server = ${p.server} AND s.uuid = ${p.uuid} AND s.day < ${since})`,
          ),
        )
        .all()
        .map((r) => [r.uuid, r.stats]),
    )
    return newest
      .filter((r) => r.day >= since)
      .map((r) => {
        const base = before.get(r.uuid) ?? {}
        const stats: Record<string, number> = {}
        for (const [k, v] of Object.entries(r.stats)) {
          // A count that went down was reset (a new world), so all of it is new.
          const b = base[k] ?? 0
          const d = v >= b ? v - b : v
          if (d > 0) stats[k] = d
        }
        return { uuid: r.uuid, stats }
      })
  }

  /** When the newest snapshot on a server was read, or null before the first one. */
  lastTaken(server: string): number | null {
    const p = schema.playerStats
    const row = this.deps.db
      .select({ at: sql<number | null>`max(${p.takenAt})` })
      .from(p)
      .where(eq(p.server, server))
      .get()
    return row?.at != null ? Number(row.at) : null
  }

  /** Deletes a player's rows (left out of stats) or a whole server's (deleted). */
  forget(server: string, uuid?: string) {
    const p = schema.playerStats
    this.deps.db
      .delete(p)
      .where(and(eq(p.server, server), uuid ? eq(p.uuid, uuid) : undefined))
      .run()
  }
}

function sameStats(a: Record<string, number>, b: Record<string, number>) {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => a[k] === b[k])
}
