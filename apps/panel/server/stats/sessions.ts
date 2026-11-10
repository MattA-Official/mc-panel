/**
 * Player sessions: one row per visit to a server, from the "joined the game" and "left the
 * game" lines the log watcher already reads (through inotify, so nothing polls). First and
 * last seen, the number of visits and playtime all come from these rows.
 *
 * The log only names the player, so the UUID comes from the `UUID of player Steve is …` line
 * Minecraft writes just before the join, or from usercache.json when that line is missing.
 *
 * A visit whose end isn't in the log (the server crashed, or the panel was down when they
 * left) ends at the last minute the metrics sampler counted anyone on, and never before it
 * started, so a lost leave doesn't add hours of playtime.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import { schema, type Db } from '../db'
import type { LogEvent } from '../notify/watchers'

/** Why a session ended. */
export type EndedBy = 'left' | 'stopped' | 'crashed' | 'lost' | 'rejoined' | 'off'

// `[12:34:56] [User Authenticator #1/INFO]: UUID of player Steve is 069a79f4-…`, or Paper's
// `[12:34:56 INFO]: …`. Like the join line, the message must start straight after the prefix,
// so chat (`<Bob> UUID of player …`) and system chat from /tellraw never match.
const UUID_LINE =
  /^\[[^\]]*\](?: \[[^\]]*\])?: UUID of player ([.*]?[A-Za-z0-9_]{1,16}) is ([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/

/** A player's name and UUID from Minecraft's login line, or null for any other line. */
export function parseUuidLine(line: string): { name: string; uuid: string } | null {
  const m = UUID_LINE.exec(line.trimEnd())
  return m ? { name: m[1]!, uuid: m[2]!.toLowerCase() } : null
}

/** A UUID seen in the log is used for a join this soon after it. */
export const UUID_TTL_MS = 60_000

export interface SessionDeps {
  db: Db
  /** The player's UUID from usercache.json (or the offline UUID on an offline server). */
  lookupUuid: (server: string, name: string) => Promise<string | null>
  /** Whether stats are kept for this player (and the server at all); everyone by default. */
  include?: (server: string, uuid: string | null) => boolean
  now?: () => number
}

export interface PlayerSummary {
  uuid: string
  name: string
  firstSeen: number
  lastSeen: number
  sessions: number
  playtimeMs: number
  online: boolean
}

export class Sessions {
  /** UUIDs from login lines, by server then lower-case name, waiting for their join. */
  private seen = new Map<string, Map<string, { uuid: string; at: number }>>()
  /** Work for each server runs in order, so a quick leave can't overtake its join. */
  private queues = new Map<string, Promise<void>>()
  private now: () => number

  constructor(private deps: SessionDeps) {
    this.now = deps.now ?? Date.now
  }

  /** A raw log line, for the UUID that comes before a join. */
  line(server: string, line: string) {
    const p = parseUuidLine(line)
    if (!p) return
    let m = this.seen.get(server)
    if (!m) this.seen.set(server, (m = new Map()))
    m.set(p.name.toLowerCase(), { uuid: p.uuid, at: this.now() })
  }

  /** An event from the log. */
  observe(server: string, e: LogEvent) {
    const at = this.now()
    switch (e.kind) {
      case 'joined':
        return this.queue(server, () => this.joined(server, e.player, at))
      case 'left':
        return this.queue(server, () => void this.closeByName(server, e.player, at, 'left'))
      case 'stopping':
        return this.queue(server, () => void this.closeAll(server, at, 'stopped'))
      case 'ready':
        // A fresh start: anyone still on from before missed their leave.
        return this.queue(server, () => void this.closeAll(server, null, 'lost'))
    }
  }

  /** Crash detection saw the server go down: everyone on it has gone. */
  crashed(server: string) {
    return this.queue(server, () => void this.closeAll(server, null, 'crashed'))
  }

  /**
   * When the panel starts: matches open sessions to who is on now. `online` is who `list`
   * says is on, or null when the server isn't running (or didn't answer), which ends them all.
   * Players on with no open session joined while the panel was down; their visit starts now.
   */
  reconcile(server: string, online: string[] | null) {
    return this.queue(server, async () => {
      const at = this.now()
      if (!online) return void this.closeAll(server, null, 'lost')
      const on = new Set(online.map((n) => n.toLowerCase()))
      const open = this.openSessions(server)
      const have = new Set<string>()
      for (const s of open) {
        if (on.has(s.name.toLowerCase())) have.add(s.name.toLowerCase())
        else this.close(s, null, 'lost')
      }
      for (const name of online) {
        if (!have.has(name.toLowerCase())) await this.joined(server, name, at)
      }
    })
  }

  /** Waits for everything queued so far (for tests and shutdown). */
  async idle() {
    await Promise.all([...this.queues.values()])
  }

  /** Stats were turned off for a server: ends the visits under way now. */
  stopRecording(server: string) {
    return this.queue(server, () => void this.closeAll(server, this.now(), 'off'))
  }

  /** A player was left out of stats: deletes their sessions and name on that server. */
  forgetPlayer(server: string, uuid: string) {
    return this.queue(server, () => {
      const { db } = this.deps
      const s = schema.playerSessions
      const n = schema.playerNames
      db.delete(s)
        .where(and(eq(s.server, server), eq(s.uuid, uuid)))
        .run()
      db.delete(n)
        .where(and(eq(n.server, server), eq(n.uuid, uuid)))
        .run()
    })
  }

  /** Forgets a deleted server's sessions and names. */
  forget(server: string) {
    const { db } = this.deps
    db.delete(schema.playerSessions).where(eq(schema.playerSessions.server, server)).run()
    db.delete(schema.playerNames).where(eq(schema.playerNames.server, server)).run()
    this.seen.delete(server)
  }

  /** First and last seen, visits and playtime for everyone who has played on a server. */
  summary(server: string): PlayerSummary[] {
    const now = this.now()
    const s = schema.playerSessions
    const rows = this.deps.db
      .select({
        uuid: s.uuid,
        firstSeen: sql<number>`min(${s.joinedAt})`,
        lastSeen: sql<number>`max(coalesce(${s.leftAt}, ${now}))`,
        sessions: sql<number>`count(*)`,
        playtimeMs: sql<number>`sum(max(0, coalesce(${s.leftAt}, ${now}) - ${s.joinedAt}))`,
        online: sql<number>`sum(${s.leftAt} is null)`,
      })
      .from(s)
      .where(eq(s.server, server))
      .groupBy(s.uuid)
      .all()
    const names = new Map(
      this.deps.db
        .select({ uuid: schema.playerNames.uuid, name: schema.playerNames.name })
        .from(schema.playerNames)
        .where(eq(schema.playerNames.server, server))
        .all()
        .map((r) => [r.uuid, r.name]),
    )
    return rows
      .map((r) => ({
        uuid: r.uuid,
        name: names.get(r.uuid) ?? r.uuid,
        firstSeen: Number(r.firstSeen),
        lastSeen: Number(r.lastSeen),
        sessions: Number(r.sessions),
        playtimeMs: Number(r.playtimeMs),
        online: Number(r.online) > 0,
      }))
      .sort((a, b) => b.lastSeen - a.lastSeen)
  }

  private queue(server: string, fn: () => void | Promise<void>): Promise<void> {
    const prev = this.queues.get(server) ?? Promise.resolve()
    const next = prev
      .then(fn)
      .catch((err) => console.error(`[flytower] player sessions for ${server} failed`, err))
    this.queues.set(server, next)
    void next.then(() => {
      if (this.queues.get(server) === next) this.queues.delete(server)
    })
    return next
  }

  private async joined(server: string, name: string, at: number) {
    const remembered = this.takeUuid(server, name)
    if (this.deps.include && !this.deps.include(server, null)) return
    const uuid = remembered ?? (await this.deps.lookupUuid(server, name))
    if (uuid && this.deps.include && !this.deps.include(server, uuid)) return
    if (!uuid) {
      console.warn(`[flytower] no UUID for ${name} on ${server}; their visit isn't counted`)
      return
    }
    const { db } = this.deps
    const s = schema.playerSessions
    db.transaction((tx) => {
      // Still on from before: that visit ended when this one began.
      tx.update(s)
        .set({ leftAt: new Date(at), endedBy: 'rejoined' })
        .where(and(eq(s.server, server), eq(s.uuid, uuid), isNull(s.leftAt)))
        .run()
      tx.insert(s)
        .values({ server, uuid, name, joinedAt: new Date(at) })
        .run()
      tx.insert(schema.playerNames)
        .values({ server, uuid, name, updatedAt: new Date(at) })
        .onConflictDoUpdate({
          target: [schema.playerNames.server, schema.playerNames.uuid],
          set: { name, updatedAt: new Date(at) },
        })
        .run()
    })
  }

  private takeUuid(server: string, name: string): string | null {
    const m = this.seen.get(server)
    const hit = m?.get(name.toLowerCase())
    if (!hit) return null
    m!.delete(name.toLowerCase())
    return this.now() - hit.at <= UUID_TTL_MS ? hit.uuid : null
  }

  private openSessions(server: string) {
    const s = schema.playerSessions
    return this.deps.db
      .select({ id: s.id, name: s.name, joinedAt: s.joinedAt })
      .from(s)
      .where(and(eq(s.server, server), isNull(s.leftAt)))
      .all()
      .map((r) => ({ ...r, server }))
  }

  private closeByName(server: string, name: string, at: number, by: EndedBy) {
    const lower = name.toLowerCase()
    for (const s of this.openSessions(server)) {
      if (s.name.toLowerCase() === lower) this.close(s, at, by)
    }
  }

  /** Ends every open session on a server, at `at` or (null) at the last minute anyone was on. */
  private closeAll(server: string, at: number | null, by: EndedBy) {
    for (const s of this.openSessions(server)) this.close(s, at, by)
  }

  private close(s: { id: number; server: string; joinedAt: Date }, at: number | null, by: EndedBy) {
    const end = Math.max(s.joinedAt.getTime(), at ?? this.lastSeenOn(s.server, s.joinedAt))
    const p = schema.playerSessions
    this.deps.db
      .update(p)
      .set({ leftAt: new Date(end), endedBy: by })
      .where(and(eq(p.id, s.id), isNull(p.leftAt)))
      .run()
  }

  /** The end of the last minute since `from` that the metrics sampler counted anyone on. */
  private lastSeenOn(server: string, from: Date): number {
    const m = schema.metrics
    const row = this.deps.db
      .select({ at: sql<number | null>`max(${m.at})` })
      .from(m)
      .where(
        and(
          eq(m.server, server),
          sql`${m.at} >= ${Math.floor(from.getTime() / 1000)}`,
          sql`${m.players} > 0`,
        ),
      )
      .get()
    return row?.at != null ? Math.min(this.now(), (Number(row.at) + 60) * 1000) : from.getTime()
  }
}
