/**
 * Scheduled tasks: each server's restarts, console commands and announcements, armed on the
 * cron timers and run one at a time per server, under the same lock as backups and changes.
 */
import { asc, eq } from 'drizzle-orm'
import {
  BUSY_WAIT_MS,
  describeTask,
  sameTask,
  type SchedulesView,
  type TaskSpec,
  type TaskView,
} from '../../shared/schedules'
import { schema, type Db } from '../db'
import type { Bus } from '../jobs/bus'
import type { Notifier } from '../notify/types'
import { RestartCancelled, runRestart, tellAll } from './restart'
import { CronTimers, nextRun } from './timers'

type Row = typeof schema.schedules.$inferSelect

export class ScheduleError extends Error {
  override name = 'ScheduleError'
}

export interface ScheduleDeps {
  db: Db
  timers?: CronTimers
  /** The per-server lock that backups, restores and spec changes take. */
  lock: {
    isBusy(server: string): boolean
    whenFree(server: string): Promise<void>
    lock(server: string): () => void
  }
  rcon: (server: string, command: string) => Promise<string>
  isRunning: (server: string) => Promise<boolean>
  /** The panel's normal restart; resolves once the server is running again. */
  restart: (server: string) => Promise<void>
  notify?: Notifier
  /** Gets `schedules:<server>` with the server's tasks whenever a run starts or ends. */
  bus?: Bus
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  busyWaitMs?: number
  /** The colour for in-game messages, from the panel's branding. Defaults to gold. */
  colour?: () => string
}

/** What one run came to. `ok` is null when it was skipped. */
interface Outcome {
  ok: boolean | null
  result: string
  reply?: string | null
}

const MAX_REPLY = 4000

export class ScheduleService {
  private timers: CronTimers
  private now: () => number
  private sleep: (ms: number) => Promise<void>
  /** Task ids with a run in progress, and how to call each off. */
  private running = new Map<number, AbortController>()

  constructor(private deps: ScheduleDeps) {
    this.timers = deps.timers ?? new CronTimers()
    this.now = deps.now ?? Date.now
    this.sleep = deps.sleep ?? ((ms) => Bun.sleep(ms))
  }

  private rows(server?: string): (Row & { tz: string })[] {
    const q = this.deps.db
      .select({ s: schema.schedules, tz: schema.servers.timezone })
      .from(schema.schedules)
      .innerJoin(schema.servers, eq(schema.servers.name, schema.schedules.server))
    return (server ? q.where(eq(schema.schedules.server, server)) : q)
      .orderBy(asc(schema.schedules.server), asc(schema.schedules.position))
      .all()
      .map((r) => ({ ...r.s, tz: r.tz }))
  }

  /** Re-reads every task and arms the timers to match. Safe to call as often as you like. */
  sync() {
    this.timers.sync(
      this.rows().map((r) => ({
        key: `task:${r.id}`,
        cron: r.cron,
        tz: r.tz,
        leadMs: r.kind === 'restart' ? leadMs(r.warn) : 0,
        fire: (at: Date) => void this.run(r.id, at.getTime(), null),
      })),
    )
  }

  /** The server's time zone and tasks, with when each runs next and how it last went. */
  view(server: string): SchedulesView {
    const tz =
      this.deps.db
        .select({ tz: schema.servers.timezone })
        .from(schema.servers)
        .where(eq(schema.servers.name, server))
        .get()?.tz ?? 'UTC'
    return { timezone: tz, tasks: this.rows(server).map((r) => this.toView(r)) }
  }

  private toView(r: Row & { tz: string }): TaskView {
    let next = this.timers.next(`task:${r.id}`)
    if (!next) {
      try {
        next = nextRun(r.cron, r.tz, this.now())
      } catch {
        next = null
      }
    }
    return {
      id: r.id,
      kind: r.kind,
      cron: r.cron,
      text: r.text,
      warn: r.warn,
      skipWhenEmpty: r.skipWhenEmpty,
      nextRunAt: next?.toISOString() ?? null,
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
      lastOk: r.lastOk,
      lastResult: r.lastResult,
      lastReply: r.lastReply,
      running: this.running.has(r.id),
    }
  }

  /** The server's tasks as specs, in order. */
  tasks(server: string): TaskSpec[] {
    return this.rows(server).map(toSpec)
  }

  /**
   * Makes the server's tasks match `tasks`, in order. Tasks that haven't changed keep their
   * last run. `timezone`, if given, becomes the server's.
   */
  replace(server: string, tasks: TaskSpec[], timezone?: string) {
    const { db } = this.deps
    const old = this.rows(server)
    db.transaction((tx) => {
      if (timezone !== undefined) {
        tx.update(schema.servers).set({ timezone }).where(eq(schema.servers.name, server)).run()
      }
      const left = [...old]
      for (const [position, t] of tasks.entries()) {
        const i = left.findIndex((r) => sameTask(toSpec(r), t))
        if (i >= 0) {
          const [kept] = left.splice(i, 1)
          tx.update(schema.schedules)
            .set({ position })
            .where(eq(schema.schedules.id, kept!.id))
            .run()
        } else {
          tx.insert(schema.schedules)
            .values({ server, position, ...t })
            .run()
        }
      }
      for (const r of left) tx.delete(schema.schedules).where(eq(schema.schedules.id, r.id)).run()
    })
    this.sync()
    this.publish(server)
  }

  /** Forgets a deleted server's tasks. */
  remove(server: string) {
    this.deps.db.delete(schema.schedules).where(eq(schema.schedules.server, server)).run()
    this.sync()
  }

  /**
   * Runs a task now. A restart still counts down its warnings first. Returns at once; the
   * result lands on the task.
   */
  runNow(server: string, id: number, userId: number): { done: Promise<void> } {
    const row = this.rows(server).find((r) => r.id === id)
    if (!row) throw new ScheduleError('No such task.')
    if (this.running.has(id)) throw new ScheduleError('That task is already running.')
    const at = this.now() + (row.kind === 'restart' ? leadMs(row.warn) : 0)
    return { done: this.run(id, at, userId) }
  }

  /** Runs a task due at `at` (a restart's own time; its countdown starts before). */
  async run(id: number, at: number, userId: number | null): Promise<void> {
    const row = this.rows().find((r) => r.id === id)
    if (!row || this.running.has(id)) return
    const server = row.server
    const abort = new AbortController()
    this.running.set(id, abort)
    this.publish(server)
    let release: (() => void) | null = null
    let outcome: Outcome
    try {
      release = await this.claim(server)
      if (!release) {
        outcome = {
          ok: false,
          result: `Skipped: a backup or change was still running after ${Math.round((this.deps.busyWaitMs ?? BUSY_WAIT_MS) / 60_000)} minutes`,
        }
      } else if (!(await this.deps.isRunning(server))) {
        outcome = { ok: null, result: "Skipped: the server wasn't running" }
      } else {
        // Waiting for the lock can make a restart late; its countdown then starts now.
        const late = Math.max(
          0,
          this.now() - (at - (row.kind === 'restart' ? leadMs(row.warn) : 0)),
        )
        outcome = await this.execute(row, at + late, abort.signal)
      }
    } catch (err) {
      outcome =
        err instanceof RestartCancelled
          ? { ok: null, result: 'Cancelled before the restart' }
          : { ok: false, result: (err as Error).message || 'Something went wrong.' }
    } finally {
      release?.()
    }
    this.record(row, outcome, userId)
    this.running.delete(id)
    this.publish(server)
  }

  /** Takes the server's lock, waiting while something else has it. Null if it never frees. */
  private async claim(server: string): Promise<(() => void) | null> {
    const deadline = this.now() + (this.deps.busyWaitMs ?? BUSY_WAIT_MS)
    for (;;) {
      if (!this.deps.lock.isBusy(server)) {
        try {
          return this.deps.lock.lock(server)
        } catch {
          // Taken between the check and the claim; wait for it like any other.
        }
      }
      const left = deadline - this.now()
      if (left <= 0) return null
      await Promise.race([this.deps.lock.whenFree(server), this.sleep(left)])
    }
  }

  /** Calls off a restart's countdown. Commands and announcements are over too fast to stop. */
  cancel(server: string, id: number) {
    const row = this.rows(server).find((r) => r.id === id)
    if (!row) throw new ScheduleError('No such task.')
    const run = this.running.get(id)
    if (!run) throw new ScheduleError("That task isn't running.")
    run.abort()
  }

  private async execute(row: Row, at: number, signal: AbortSignal): Promise<Outcome> {
    const rcon = (command: string) => this.deps.rcon(row.server, command)
    const colour = this.deps.colour?.()
    if (row.kind === 'command') {
      const reply = await rcon(row.text ?? '')
      return { ok: true, result: 'Ran', reply: reply.slice(0, MAX_REPLY) }
    }
    if (row.kind === 'announce') {
      await rcon(tellAll(row.text ?? '', colour))
      return { ok: true, result: 'Announced' }
    }
    const out = await runRestart(
      {
        rcon,
        restart: () => this.deps.restart(row.server),
        now: this.now,
        sleep: this.sleep,
        colour,
      },
      { warn: row.warn, skipWhenEmpty: row.skipWhenEmpty },
      at,
      signal,
    )
    const how = out.empty
      ? 'nobody was online, so no countdown'
      : `${out.warned} warning${out.warned === 1 ? '' : 's'}`
    return { ok: true, result: `Restarted in ${out.tookSeconds}s (${how})` }
  }

  private record(row: Row, o: Outcome, userId: number | null) {
    const { db } = this.deps
    db.update(schema.schedules)
      .set({
        lastRunAt: new Date(this.now()),
        lastOk: o.ok,
        lastResult: o.result,
        lastReply: o.reply ?? null,
      })
      .where(eq(schema.schedules.id, row.id))
      .run()
    db.insert(schema.audit)
      .values({
        userId,
        action: 'schedule.run',
        target: row.server,
        detail: { task: describeTask(toSpec(row)), result: o.result, ok: o.ok },
      })
      .run()
    const kind = 'schedule.failed' as const
    if (o.ok === false) {
      this.deps.notify?.notify({
        kind,
        server: row.server,
        title: `Scheduled ${row.kind === 'restart' ? 'restart' : row.kind === 'command' ? 'command' : 'announcement'} failed`,
        detail: `${describeTask(toSpec(row))}: ${o.result}`,
        severity: 'warning',
        link: `/servers/${row.server}/settings/schedules`,
      })
    } else if (o.ok === true) {
      this.deps.notify?.resolve({
        kind,
        server: row.server,
        title: 'Scheduled tasks are working again',
        severity: 'ok',
        link: `/servers/${row.server}/settings/schedules`,
      })
    }
  }

  private publish(server: string) {
    this.deps.bus?.publish(`schedules:${server}`, this.view(server))
  }
}

function toSpec(r: Row): TaskSpec {
  return { kind: r.kind, cron: r.cron, text: r.text, warn: r.warn, skipWhenEmpty: r.skipWhenEmpty }
}

/** How early a restart starts: its longest warning. */
function leadMs(warn: number[]) {
  return Math.max(0, ...warn) * 1000
}
