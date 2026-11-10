import { offlineUuid } from '@flytower/providers'
import { join } from 'node:path'
import { Sessions } from '../stats/sessions'
import { StatsSnapshot } from '../stats/snapshot'
import { parseList } from '../players'
import { schema } from '../db'
import { eq } from 'drizzle-orm'
import { readStatsSettings, type StatsSettings } from '../../shared/stats-settings'
import type { Period, StatsOverview } from '../../shared/leaderboards'
import { buildBoards, buildCards, periodStart } from '../stats/leaderboards'

/** A server's player stats settings, with defaults filled in. */
export function statsSettings(server: string): StatsSettings {
  const row = useDb()
    .select({ stats: schema.servers.stats })
    .from(schema.servers)
    .where(eq(schema.servers.name, server))
    .get()
  return readStatsSettings(row?.stats)
}

/** Whether stats are kept on a server, and (given a UUID) for that player. */
export function statsInclude(server: string, uuid: string | null): boolean {
  const s = statsSettings(server)
  if (!s.enabled) return false
  return !uuid || !s.leaveOut.some((p) => p.uuid === uuid)
}

/**
 * After a server's stats settings change: turning them off ends the visits under way, and a
 * player newly left out has everything kept about them on that server deleted.
 */
export function statsChanged(server: string, before: unknown) {
  const was = readStatsSettings(before)
  const now = statsSettings(server)
  if (was.enabled && !now.enabled) void useSessions().stopRecording(server)
  const had = new Set(was.leaveOut.map((p) => p.uuid))
  for (const p of now.leaveOut) {
    if (had.has(p.uuid)) continue
    void useSessions().forgetPlayer(server, p.uuid)
    useStatsSnapshot().forget(server, p.uuid)
  }
}

let sessions: Sessions | undefined

/** Player sessions for every server, from the log. */
export function useSessions(): Sessions {
  if (!sessions) {
    const s = new Sessions({
      db: useDb(),
      include: statsInclude,
      lookupUuid: async (server, name) => {
        const cache = await readUserCache(server)
        if (Array.isArray(cache)) {
          const lower = name.toLowerCase()
          for (const e of cache as { name?: unknown; uuid?: unknown }[]) {
            if (typeof e?.name === 'string' && typeof e.uuid === 'string')
              if (e.name.toLowerCase() === lower) return e.uuid.toLowerCase()
          }
        }
        // An offline-mode server gives every name a fixed UUID, so it can be worked out here.
        const props = await readProperties(server).catch(() => ({}) as Record<string, string>)
        return props['online-mode'] === 'false' ? offlineUuid(name) : null
      },
    })
    const logs = useLogWatcher()
    logs.listenLines((server, line) => s.line(server, line))
    logs.listen((server, e) => void s.observe(server, e))
    sessions = s
  }
  return sessions
}

/**
 * Once, when the panel starts: lines up the sessions left open with who is actually on, since
 * players may have come and gone while the panel was down.
 */
export async function reconcileSessions() {
  const s = useSessions()
  const status = await useStatus()
    .current()
    .catch(() => null)
  // Without knowing what's running, leave the sessions as they are.
  if (!status) return
  const names = useDb()
    .select({ name: schema.servers.name })
    .from(schema.servers)
    .all()
    .map((r) => r.name)
  await Promise.all(
    names.map(async (server) => {
      let online: string[] | null = null
      if (status[server] === 'active') {
        online = await useConsole()
          .command(server, 'list', { echo: false })
          .then((reply) => parseList(reply)?.names ?? null)
          .catch(() => null)
      }
      await s.reconcile(server, online)
    }),
  )
}

let snapshot: StatsSnapshot | undefined

/** The daily stats snapshot. */
export function useStatsSnapshot(): StatsSnapshot {
  snapshot ??= new StatsSnapshot({
    db: useDb(),
    include: statsInclude,
    worldDir: async (server) => {
      const level = (await readProperties(server).catch(() => ({}) as Record<string, string>))[
        'level-name'
      ]
      return join(serverDir(server), level || 'world')
    },
  })
  return snapshot
}

/** The local hour each server's snapshot is taken in. */
export const SNAPSHOT_HOUR = 3

/** The hour (0-23) it is now in a time zone. */
function hourIn(tz: string, at: number): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(
      at,
    ),
  )
}

/**
 * Called every hour at half past: takes the snapshot for each server where it's now 03:xx in
 * the server's own time zone.
 */
export async function takeStatsSnapshots() {
  const now = Date.now()
  const rows = useDb()
    .select({ name: schema.servers.name, tz: schema.servers.timezone })
    .from(schema.servers)
    .all()
  for (const { name, tz } of rows) {
    let due: boolean
    try {
      due = hourIn(tz, now) === SNAPSHOT_HOUR
    } catch {
      due = hourIn('UTC', now) === SNAPSHOT_HOUR
    }
    if (!due || !statsInclude(name, null)) continue
    try {
      await useStatsSnapshot().take(name, tz)
    } catch (err) {
      console.error(`[flytower] stats snapshot for ${name} failed`, err)
    }
  }
}

/** A server's time zone, UTC when it isn't set. */
function serverTimezone(server: string): string {
  return (
    useDb()
      .select({ tz: schema.servers.timezone })
      .from(schema.servers)
      .where(eq(schema.servers.name, server))
      .get()?.tz ?? 'UTC'
  )
}

/** Names by UUID from usercache.json, for players with stats but no sessions. */
async function userCacheNames(server: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const cache = await readUserCache(server).catch(() => null)
  if (!Array.isArray(cache)) return out
  for (const e of cache as { name?: unknown; uuid?: unknown }[]) {
    if (typeof e?.name === 'string' && typeof e.uuid === 'string')
      out.set(e.uuid.toLowerCase(), e.name)
  }
  return out
}

/**
 * The leaderboards and player cards for a period. Left-out players never appear, whatever
 * is in the tables.
 */
export async function statsOverview(
  server: string,
  period: Period,
  opts: { limit?: number; cards?: boolean } = {},
): Promise<StatsOverview> {
  const settings = statsSettings(server)
  const leftOut = new Set(settings.leaveOut.map((p) => p.uuid))
  const since = periodStart(period, serverTimezone(server), Date.now())
  const snap = useStatsSnapshot()
  const totals = snap.totals(server, since)
  await useSessions().idle()
  const sessions = useSessions().summary(server)
  const fromSessions = new Map(sessions.map((s) => [s.uuid, s.name]))
  const fromCache = await userCacheNames(server)
  const nameOf = (uuid: string) => {
    const n = fromSessions.get(uuid)
    return n && n !== uuid ? n : (fromCache.get(uuid) ?? uuid)
  }
  return {
    enabled: settings.enabled,
    period,
    since: since ?? null,
    updatedAt: snap.lastTaken(server),
    boards: buildBoards(totals, nameOf, leftOut, opts.limit ?? 10),
    players: opts.cards === false ? [] : buildCards(totals, sessions, nameOf, leftOut),
  }
}
