/**
 * The background update check: Flytower itself, each server's content and Minecraft version,
 * and the Java runtimes. Results are kept in the update_status table, so badges survive a
 * restart, and a failed check never clears the last good result. Nothing is ever applied.
 */
import { and, eq } from 'drizzle-orm'
import { schema, type Db } from './db'
import { compareJava, type InstalledRuntime } from './java-updates'
import type {
  Checked,
  ContentUpdates,
  FlytowerUpdate,
  JavaUpdate,
  MinecraftUpdate,
  UpdatesSnapshot,
} from '../shared/updates'

export type Scope = 'flytower' | 'content' | 'minecraft' | 'java'

export interface Summaries {
  flytower: FlytowerUpdate
  content: ContentUpdates
  minecraft: MinecraftUpdate
  java: JavaUpdate
}

export interface CheckSources {
  flytower(): Promise<FlytowerUpdate>
  content(server: string): Promise<ContentUpdates>
  minecraft(server: string): Promise<MinecraftUpdate>
  runtimes(): Promise<InstalledRuntime[]>
  latestJava(major: number): Promise<string | null>
  servers(): { name: string; javaMajor: number }[]
}

export interface CheckerOptions {
  db: Db
  sources: CheckSources
  /** Called with every good result, for notifications. */
  found?: <S extends Scope>(scope: S, subject: string, summary: Summaries[S]) => void
  now?: () => number
}

/** Six hours between scheduled checks. */
export const CHECK_EVERY_MS = 6 * 3600_000
/** Opening the panel checks again if the last check is older than this. */
export const ON_OPEN_AFTER_MS = 3600_000

/**
 * The cron line for the six-hourly check, at a minute and hour offset picked at random, so
 * many installs don't all ask Modrinth and GitHub at the same moment.
 */
export function checkCron(random: () => number = Math.random): string {
  const minute = Math.floor(random() * 60)
  const hour = Math.floor(random() * 6)
  return `${minute} ${hour}-23/6 * * *`
}

/**
 * Whether a newer Minecraft is out for this server, and whether everything installed is
 * ready for it. `versions` is the loader's releases, newest first; `problemsFor` plans the
 * server at another version and returns what would stop it. At most `tries` versions are
 * planned, newest first.
 */
export async function findMinecraftUpdate(
  current: string,
  versions: string[],
  problemsFor: (version: string) => Promise<string[]>,
  tries = 3,
): Promise<MinecraftUpdate> {
  const at = versions.indexOf(current)
  const newer = at < 0 ? [] : versions.slice(0, at)
  const out: MinecraftUpdate = { current, newest: newer[0] ?? null, ready: null, missing: [] }
  for (const version of newer.slice(0, tries)) {
    const problems = await problemsFor(version)
    if (!problems.length) {
      out.ready = version
      break
    }
    if (version === out.newest) out.missing = problems
  }
  return out
}

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, 300) || 'Unknown error'

type Row = typeof schema.updateStatus.$inferSelect

const iso = (d: Date | null) => (d ? d.toISOString() : null)

function checked<T>(row: Row | undefined): Checked<T> | null {
  if (!row) return null
  return {
    summary: (row.summary ?? null) as T | null,
    checkedAt: iso(row.checkedAt),
    error: row.lastError,
    errorAt: iso(row.errorAt),
  }
}

export class UpdateChecker {
  private running: Promise<void> | null = null
  private listeners = new Set<(s: UpdatesSnapshot) => void>()
  private lastRun: number | null
  private now: () => number

  constructor(private o: CheckerOptions) {
    this.now = o.now ?? Date.now
    // The last run is when any check last finished, good or bad.
    let last: number | null = null
    for (const r of o.db.select().from(schema.updateStatus).all()) {
      for (const d of [r.checkedAt, r.errorAt]) {
        if (d && (last === null || d.getTime() > last)) last = d.getTime()
      }
    }
    this.lastRun = last
  }

  lastRunAt(): number | null {
    return this.lastRun
  }

  checking(): boolean {
    return this.running !== null
  }

  /** Checks everything. A check already running is joined, not started twice. */
  checkAll(): Promise<void> {
    this.running ??= this.run().finally(() => {
      this.running = null
      this.lastRun = this.now()
      this.publish()
    })
    this.publish()
    return this.running
  }

  /** Starts a check in the background if the last one is older than `maxAgeMs`. */
  maybeCheck(maxAgeMs: number): boolean {
    if (this.running) return false
    if (this.lastRun !== null && this.now() - this.lastRun < maxAgeMs) return false
    void this.checkAll().catch((err) => console.error('[flytower] update check failed', err))
    return true
  }

  private async run() {
    const { sources } = this.o
    const servers = sources.servers()
    await this.record('flytower', '*', () => sources.flytower())
    for (const s of servers) {
      await this.record('content', s.name, () => sources.content(s.name))
      await this.record('minecraft', s.name, () => sources.minecraft(s.name))
    }
    let runtimes: InstalledRuntime[] | null = null
    try {
      runtimes = await sources.runtimes()
    } catch (err) {
      console.error('[flytower] listing Java runtimes failed', err)
    }
    if (runtimes) {
      for (const r of runtimes) {
        await this.record('java', String(r.major), async () => {
          const latest = await sources.latestJava(r.major)
          return {
            major: r.major,
            installed: r.version,
            latest: latest && compareJava(latest, r.version) > 0 ? latest : null,
            servers: servers.filter((s) => s.javaMajor === r.major).map((s) => s.name),
          }
        })
      }
      const keep = new Set(runtimes.map((r) => String(r.major)))
      for (const row of this.rows('java')) {
        if (!keep.has(row.subject)) this.delete('java', row.subject)
      }
    }
    // Servers deleted since: their results go.
    const names = new Set(servers.map((s) => s.name))
    for (const row of [...this.rows('content'), ...this.rows('minecraft')]) {
      if (!names.has(row.subject)) this.delete(row.scope, row.subject)
    }
  }

  /**
   * Runs one check and keeps its result. A failure keeps the last good result and only
   * records the error.
   */
  async record<S extends Scope>(
    scope: S,
    subject: string,
    fn: () => Promise<Summaries[S]>,
  ): Promise<Summaries[S] | null> {
    try {
      const summary = await fn()
      this.store(scope, subject, summary)
      return summary
    } catch (err) {
      const at = new Date(this.now())
      const lastError = message(err)
      this.o.db
        .insert(schema.updateStatus)
        .values({ scope, subject, lastError, errorAt: at })
        .onConflictDoUpdate({
          target: [schema.updateStatus.scope, schema.updateStatus.subject],
          set: { lastError, errorAt: at },
        })
        .run()
      this.publish()
      return null
    }
  }

  /** Keeps a good result (also used when the Content tab works one out itself). */
  store<S extends Scope>(scope: S, subject: string, summary: Summaries[S]) {
    const at = new Date(this.now())
    this.o.db
      .insert(schema.updateStatus)
      .values({ scope, subject, summary, checkedAt: at, lastError: null, errorAt: null })
      .onConflictDoUpdate({
        target: [schema.updateStatus.scope, schema.updateStatus.subject],
        set: { summary, checkedAt: at, lastError: null, errorAt: null },
      })
      .run()
    try {
      this.o.found?.(scope, subject, summary)
    } catch (err) {
      console.error('[flytower] acting on an update check failed', err)
    }
    this.publish()
  }

  /** Forgets a deleted server. */
  forget(server: string) {
    this.delete('content', server)
    this.delete('minecraft', server)
    this.publish()
  }

  snapshot(): UpdatesSnapshot {
    const rows = this.o.db.select().from(schema.updateStatus).all()
    const servers: UpdatesSnapshot['servers'] = {}
    for (const s of this.o.sources.servers()) {
      const of = (scope: Scope) => rows.find((r) => r.scope === scope && r.subject === s.name)
      servers[s.name] = { content: checked(of('content')), minecraft: checked(of('minecraft')) }
    }
    return {
      checking: this.checking(),
      lastRunAt: this.lastRun === null ? null : new Date(this.lastRun).toISOString(),
      flytower: checked(rows.find((r) => r.scope === 'flytower')),
      java: rows
        .filter((r) => r.scope === 'java')
        .sort((a, b) => Number(a.subject) - Number(b.subject))
        .map((r) => checked<JavaUpdate>(r)!),
      servers,
    }
  }

  /** Calls `emit` with the snapshot now and whenever it changes. */
  watch(emit: (s: UpdatesSnapshot) => void): () => void {
    this.listeners.add(emit)
    emit(this.snapshot())
    return () => this.listeners.delete(emit)
  }

  private publish() {
    if (!this.listeners.size) return
    const s = this.snapshot()
    for (const l of this.listeners) {
      try {
        l(s)
      } catch (err) {
        console.error('[flytower] update listener failed', err)
      }
    }
  }

  private rows(scope: Scope) {
    return this.o.db
      .select()
      .from(schema.updateStatus)
      .where(eq(schema.updateStatus.scope, scope))
      .all()
  }

  private delete(scope: Scope, subject: string) {
    this.o.db
      .delete(schema.updateStatus)
      .where(and(eq(schema.updateStatus.scope, scope), eq(schema.updateStatus.subject, subject)))
      .run()
  }
}
