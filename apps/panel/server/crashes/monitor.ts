/**
 * Crash detection. Watches each server's systemd state (from the status poller) and whether
 * its console answers (from the metrics sampler), and turns what it sees into events,
 * notifications and a condition the UI shows: crashed, crash-looping or not responding.
 *
 * systemd does the restarting (Restart=on-failure, three tries in ten minutes); this only
 * notices. Stops, starts and restarts that Flytower itself asked for are never crashes: the
 * agent wrapper marks a server as "expected" while such a call is in flight and shortly after.
 */
import { and, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import type { Result } from '@flytower/protocol'
import { schema, type Db } from '../db'
import type { Notifier } from '../notify/types'
import { findCrashReport, readLogTail, type CrashReport } from './files'

export type Status = Result<'service.status'>
export type Condition = 'crashed' | 'crash-loop' | 'unresponsive' | null
export type EventKind = (typeof schema.serverEvents.$inferSelect)['kind']

/** The newest crash someone hasn't dismissed yet, for the banner. */
export interface CrashSummary {
  id: number
  at: string
  kind: EventKind
  cause: string | null
  crashReport: string | null
}

export interface Health {
  condition: Condition
  crash: CrashSummary | null
}
export type HealthMap = Record<string, Health>

export const KEEP_MS = 30 * 24 * 3600_000
/** How long after a Flytower-initiated stop, start or restart a state change is still expected. */
export const EXPECTED_GRACE_MS = 20_000
/** Missed console answers in a row (one a minute) before a server counts as not responding. */
export const MISSES = 5
/** The same, before the console has answered at all since it started: big worlds load slowly. */
export const STARTUP_MISSES = 15
/** Crashes in this window that Flytower restarted itself, before it gives up. */
export const LOOP_WINDOW_MS = 10 * 60_000
export const LOOP_CRASHES = 3
/** Banners for crashes older than this aren't shown. */
const BANNER_MS = 7 * 24 * 3600_000

export interface CrashDeps {
  db: Db
  /** A server's folder. */
  serverDir: (server: string) => string
  notify: Pick<Notifier, 'notify' | 'resolve'>
  /** Starts or restarts a server (through the agent, so it counts as expected). */
  start: (server: string) => Promise<void>
  restart: (server: string) => Promise<void>
  now?: () => Date
}

interface Track {
  last: Status | null
  condition: Condition
  /** When it was last seen go from not running to running. */
  upAt: number | null
  /** Whether the console has answered since it started. */
  answered: boolean
  missed: number
  /** Restarted once for not responding; not again until it answers. */
  autoRestarted: boolean
  inFlight: number
  expectedUntil: number
}

const SIGNALS: Record<number, string> = {
  1: 'SIGHUP',
  2: 'SIGINT',
  3: 'SIGQUIT',
  4: 'SIGILL',
  6: 'SIGABRT',
  7: 'SIGBUS',
  8: 'SIGFPE',
  9: 'SIGKILL',
  11: 'SIGSEGV',
  15: 'SIGTERM',
}

/** What went wrong, in a sentence, from systemd's view, the crash report and the log. */
export function describeCrash(
  s: Pick<Status, 'result' | 'exitKind' | 'exitStatus'>,
  report: CrashReport | null,
  logTail: string[],
): { kind: 'crash' | 'oom'; cause: string } {
  if (s.result === 'oom-kill') {
    return {
      kind: 'oom',
      cause:
        'It went over its memory limit and the system stopped it. Give it more memory on the Settings tab, or fewer mods.',
    }
  }
  if (logTail.some((l) => l.includes('java.lang.OutOfMemoryError'))) {
    return {
      kind: 'oom',
      cause: 'Java ran out of memory (OutOfMemoryError). Give it more memory on the Settings tab.',
    }
  }
  if (report?.description)
    return { kind: 'crash', cause: `Minecraft crashed: ${report.description}` }
  if (report?.java) {
    return { kind: 'crash', cause: 'Java itself crashed. The error file has the details.' }
  }
  if (s.exitKind === 'exited' && s.exitStatus != null) {
    return { kind: 'crash', cause: `It exited with code ${s.exitStatus}.` }
  }
  if ((s.exitKind === 'killed' || s.exitKind === 'dumped') && s.exitStatus != null) {
    const sig = SIGNALS[s.exitStatus] ?? `signal ${s.exitStatus}`
    return {
      kind: 'crash',
      cause: `It was killed by ${sig}${s.exitKind === 'dumped' ? ' and dumped core' : ''}.`,
    }
  }
  if (s.result === 'timeout') return { kind: 'crash', cause: 'It took too long to start or stop.' }
  return { kind: 'crash', cause: 'It stopped unexpectedly.' }
}

type Listener = (health: HealthMap) => void

export class CrashMonitor {
  private tracks = new Map<string, Track>()
  private listeners = new Set<Listener>()
  private now: () => Date
  private lastPrune = 0

  constructor(private deps: CrashDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  private track(server: string): Track {
    let t = this.tracks.get(server)
    if (!t) {
      t = {
        last: null,
        condition: null,
        upAt: null,
        answered: false,
        missed: 0,
        autoRestarted: false,
        inFlight: 0,
        expectedUntil: 0,
      }
      this.tracks.set(server, t)
    }
    return t
  }

  private nowMs() {
    return this.now().getTime()
  }

  /**
   * Marks a server as being stopped, started or restarted by Flytower. Call the returned
   * function when the call finishes; changes stay expected for a short while after.
   */
  expect(server: string): () => void {
    const t = this.track(server)
    t.inFlight++
    let done = false
    return () => {
      if (done) return
      done = true
      t.inFlight--
      t.expectedUntil = this.nowMs() + EXPECTED_GRACE_MS
    }
  }

  private expected(t: Track) {
    return t.inFlight > 0 || this.nowMs() < t.expectedUntil
  }

  // ------------------------------------------------------------------ systemd

  /** Takes a round of statuses from the poller. Servers it couldn't ask about are null. */
  async observe(statuses: Record<string, Status | null>) {
    let changed = false
    for (const [server, s] of Object.entries(statuses)) {
      try {
        if (s && s.active !== 'unknown' && (await this.observeOne(server, s))) changed = true
      } catch (err) {
        console.error(`[flytower] crash check for ${server} failed`, err)
      }
    }
    if (changed) this.emit()
    if (this.nowMs() - this.lastPrune > 3600_000) {
      this.lastPrune = this.nowMs()
      this.prune()
    }
  }

  /** Returns true if the server's condition or banner changed. */
  private async observeOne(server: string, s: Status): Promise<boolean> {
    const t = this.track(server)
    const last = t.last
    t.last = s
    const before = t.condition

    if (!last) {
      // The first look after Flytower starts: take things as they are, without alerts.
      if (s.active === 'failed') {
        t.condition = s.result === 'start-limit-hit' ? 'crash-loop' : 'crashed'
      } else if (s.active === 'active') {
        t.upAt = this.nowMs()
      }
      return t.condition !== before
    }

    const expected = this.expected(t)
    const wasUp = last.active === 'active'
    const restarted = last.restarts != null && s.restarts != null && s.restarts > last.restarts
    const failure = (s.result ?? 'success') !== 'success'

    if (s.active === 'active') {
      if (!wasUp) {
        t.upAt = this.nowMs()
        t.answered = false
        t.missed = 0
      }
      let crashed = false
      // It went down and systemd brought it back between two looks.
      if (wasUp && restarted && !expected) {
        await this.crashed(server, s, t, true)
        crashed = true
      }
      if (t.condition === 'crashed' || t.condition === 'crash-loop') {
        this.recovered(server, t)
      }
      return crashed || t.condition !== before
    }

    if (s.active === 'activating' || s.active === 'failed') {
      if (!expected && failure && (wasUp || restarted)) {
        await this.crashed(server, s, t)
        if (s.result === 'start-limit-hit') this.looping(server, t)
        return true
      }
      if (s.active === 'failed' && s.result === 'start-limit-hit' && t.condition !== 'crash-loop') {
        this.looping(server, t)
        return true
      }
      if (s.active === 'failed' && failure && !expected && t.condition === null) {
        t.condition = 'crashed'
      }
      if (t.condition === 'unresponsive') t.condition = null
      return t.condition !== before
    }

    if (s.active === 'inactive') {
      if (t.condition === 'unresponsive') t.condition = null
      // A clean exit nobody here asked for: someone typed `stop`, or Minecraft stopped after
      // a crash it reported. Only the second is a crash, and systemd won't restart it.
      if (wasUp && !expected) {
        const report = await findCrashReport(this.deps.serverDir(server), this.since(t))
        if (report && !report.java) {
          await this.crashed(server, s, t, false, report)
          if (this.recentCrashes(server) >= LOOP_CRASHES) {
            this.looping(server, t)
          } else {
            void this.deps
              .start(server)
              .catch((err) =>
                console.error(`[flytower] restarting ${server} after a crash failed`, err),
              )
          }
          return true
        }
      }
      return t.condition !== before
    }
    return false
  }

  /** When the run that just ended started, give or take, for finding its crash report. */
  private since(t: Track) {
    return (t.upAt ?? this.nowMs() - LOOP_WINDOW_MS) - 5000
  }

  private recentCrashes(server: string) {
    const from = new Date(this.nowMs() - LOOP_WINDOW_MS)
    return this.deps.db
      .select({ id: schema.serverEvents.id })
      .from(schema.serverEvents)
      .where(
        and(
          eq(schema.serverEvents.server, server),
          inArray(schema.serverEvents.kind, ['crash', 'oom']),
          gte(schema.serverEvents.at, from),
        ),
      )
      .all().length
  }

  private async crashed(
    server: string,
    s: Status,
    t: Track,
    missed = false,
    found?: CrashReport | null,
  ) {
    const dir = this.deps.serverDir(server)
    const [report, logTail] = await Promise.all([
      found !== undefined ? found : findCrashReport(dir, this.since(t)),
      readLogTail(dir),
    ])
    // When it's already back up, systemd no longer knows how the last run ended.
    const { kind, cause } = describeCrash(
      missed ? { result: null, exitKind: null, exitStatus: null } : s,
      report,
      missed ? [] : logTail,
    )
    this.record(server, {
      kind,
      cause,
      result: missed ? null : (s.result ?? null),
      exitStatus: missed ? null : (s.exitStatus ?? null),
      crashReport: report?.path ?? null,
      logTail: missed ? null : logTail,
    })
    this.audit('server.crashed', server, { cause })
    t.condition = 'crashed'
    t.missed = 0
    t.answered = false
    this.deps.notify.notify({
      kind: 'server.crashed',
      server,
      title: kind === 'oom' ? 'Server ran out of memory' : 'Server crashed',
      detail:
        cause +
        (s.active === 'activating'
          ? '\n\nIt will be restarted automatically.'
          : s.active === 'active'
            ? '\n\nIt has already been restarted.'
            : ''),
      severity: 'critical',
      link: `/servers/${server}`,
    })
  }

  private looping(server: string, t: Track) {
    t.condition = 'crash-loop'
    const cause = `It crashed ${LOOP_CRASHES} times in ${LOOP_WINDOW_MS / 60_000} minutes, so it has been left stopped. Start it again once the cause is fixed.`
    this.record(server, { kind: 'crash-loop', cause })
    this.audit('server.crash_loop', server, {})
    this.deps.notify.notify({
      kind: 'server.crash_loop',
      server,
      title: 'Server keeps crashing',
      detail: cause,
      severity: 'critical',
      link: `/servers/${server}`,
    })
  }

  private recovered(server: string, t: Track) {
    const was = t.condition
    t.condition = null
    this.record(server, { kind: 'recovered', cause: 'It is running again.' })
    if (was === 'crash-loop') {
      this.deps.notify.resolve({
        kind: 'server.crash_loop',
        server,
        title: 'Server is running again',
        severity: 'ok',
        link: `/servers/${server}`,
      })
    }
    this.deps.notify.resolve({
      kind: 'server.crashed',
      server,
      title: 'Server is back up',
      detail: 'It started again after crashing.',
      severity: 'ok',
      link: `/servers/${server}`,
    })
  }

  // ------------------------------------------------------------------ the console

  /** Takes whether a running server's console answered this minute's questions. */
  async answered(server: string, ok: boolean, restartWhenUnresponsive = false) {
    const t = this.track(server)
    if (t.last && t.last.active !== 'active') return
    if (ok) {
      t.answered = true
      t.missed = 0
      t.autoRestarted = false
      if (t.condition === 'unresponsive') {
        t.condition = null
        this.record(server, { kind: 'recovered', cause: 'The console is answering again.' })
        this.deps.notify.resolve({
          kind: 'server.unresponsive',
          server,
          title: 'Server is responding again',
          severity: 'ok',
          link: `/servers/${server}`,
        })
        this.emit()
      }
      return
    }
    if (t.condition !== null) return
    t.missed++
    if (t.missed < (t.answered ? MISSES : STARTUP_MISSES)) return

    const minutes = t.missed
    const restart = restartWhenUnresponsive && !t.autoRestarted
    t.condition = 'unresponsive'
    const cause = `The console hasn't answered for ${minutes} minutes, though the process is still running.${
      restart ? ' Flytower is restarting it, as set on its Settings tab.' : ''
    }`
    this.record(server, {
      kind: 'unresponsive',
      cause,
      logTail: await readLogTail(this.deps.serverDir(server)),
    })
    this.audit('server.unresponsive', server, { restarted: restart })
    this.deps.notify.notify({
      kind: 'server.unresponsive',
      server,
      title: 'Server is not responding',
      detail: cause,
      severity: 'warning',
      link: `/servers/${server}`,
    })
    this.emit()
    if (restart) {
      t.autoRestarted = true
      t.missed = 0
      t.answered = false
      try {
        await this.deps.restart(server)
      } catch (err) {
        console.error(`[flytower] restarting unresponsive ${server} failed`, err)
      }
    }
  }

  // ------------------------------------------------------------------ reading

  condition(server: string): Condition {
    return this.tracks.get(server)?.condition ?? null
  }

  health(names: string[]): HealthMap {
    const since = new Date(this.nowMs() - BANNER_MS)
    const rows = names.length
      ? this.deps.db
          .select()
          .from(schema.serverEvents)
          .where(
            and(
              inArray(schema.serverEvents.server, names),
              inArray(schema.serverEvents.kind, ['crash', 'oom', 'crash-loop']),
              isNull(schema.serverEvents.dismissedAt),
              gte(schema.serverEvents.at, since),
            ),
          )
          .orderBy(desc(schema.serverEvents.id))
          .all()
      : []
    const out: HealthMap = {}
    for (const name of names) {
      const r = rows.find((e) => e.server === name)
      out[name] = {
        condition: this.condition(name),
        crash: r
          ? {
              id: r.id,
              at: r.at.toISOString(),
              kind: r.kind,
              cause: r.cause,
              crashReport: r.crashReport,
            }
          : null,
      }
    }
    return out
  }

  events(server: string) {
    return this.deps.db
      .select()
      .from(schema.serverEvents)
      .where(eq(schema.serverEvents.server, server))
      .orderBy(desc(schema.serverEvents.id))
      .limit(200)
      .all()
  }

  /** Hides a crash's banner (and any older ones). Returns false if there's no such event. */
  dismiss(server: string, id: number): boolean {
    const row = this.deps.db
      .select({ id: schema.serverEvents.id })
      .from(schema.serverEvents)
      .where(and(eq(schema.serverEvents.server, server), eq(schema.serverEvents.id, id)))
      .get()
    if (!row) return false
    this.deps.db
      .update(schema.serverEvents)
      .set({ dismissedAt: this.now() })
      .where(
        and(
          eq(schema.serverEvents.server, server),
          isNull(schema.serverEvents.dismissedAt),
          lt(schema.serverEvents.id, id + 1),
        ),
      )
      .run()
    this.emit()
    return true
  }

  /** Forgets a deleted server. */
  forget(server: string) {
    this.tracks.delete(server)
    this.deps.db.delete(schema.serverEvents).where(eq(schema.serverEvents.server, server)).run()
    this.emit()
  }

  prune() {
    this.deps.db
      .delete(schema.serverEvents)
      .where(lt(schema.serverEvents.at, new Date(this.nowMs() - KEEP_MS)))
      .run()
  }

  // ------------------------------------------------------------------ plumbing

  /** Calls `listener` whenever a condition or banner changes; it re-reads health itself. */
  watch(listener: Listener, names: () => string[]): () => void {
    const l: Listener = () => listener(this.health(names()))
    this.listeners.add(l)
    l({})
    return () => this.listeners.delete(l)
  }

  private emit() {
    for (const l of this.listeners) {
      try {
        l({})
      } catch (err) {
        console.error('[flytower] health listener failed', err)
      }
    }
  }

  private record(
    server: string,
    e: Omit<typeof schema.serverEvents.$inferInsert, 'server' | 'at'>,
  ) {
    this.deps.db
      .insert(schema.serverEvents)
      .values({ server, at: this.now(), ...e })
      .run()
  }

  private audit(action: string, server: string, detail: Record<string, unknown>) {
    this.deps.db
      .insert(schema.audit)
      .values({ at: this.now(), action, target: server, detail })
      .run()
  }
}
