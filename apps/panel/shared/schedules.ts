/**
 * Scheduled tasks: restarts with an in-game countdown, console commands and announcements.
 * Shared by the browser (the Schedules tab) and the panel's API, so it holds only the
 * schema pieces and pure helpers.
 */
import { z } from 'zod'

export const TASK_KINDS = ['restart', 'command', 'announce'] as const
export type TaskKind = (typeof TASK_KINDS)[number]

/** How long a scheduled task waits for a backup or change to finish before skipping. */
export const BUSY_WAIT_MS = 10 * 60_000

/** Warnings before a restart, when none are given. */
export const DEFAULT_WARNINGS = ['15m', '5m', '1m', '10s']

export const MAX_WARNING_SECONDS = 2 * 3600

/** "15m", "10s", "1h" to seconds, or null. */
export function parseDuration(text: string): number | null {
  const m = /^\s*(\d{1,5})\s*([smh])\s*$/i.exec(text)
  if (!m) return null
  const n = Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2]!.toLowerCase() as 's' | 'm' | 'h']
  return n > 0 ? n : null
}

/** Seconds the short way, as a spec writes them: 900 is "15m", 90 is "90s". */
export function formatDuration(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`
  if (seconds % 60 === 0) return `${seconds / 60}m`
  return `${seconds}s`
}

/** Seconds the way players read them: "15 minutes", "1 minute", "10 seconds". */
export function spokenDuration(seconds: number): string {
  const [n, unit] =
    seconds % 3600 === 0
      ? [seconds / 3600, 'hour']
      : seconds % 60 === 0
        ? [seconds / 60, 'minute']
        : [seconds, 'second']
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

const Cron = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe('A cron expression, like "0 5 * * *" for 5am every day.')

const Warning = z
  .string()
  .refine((v) => parseDuration(v) !== null, 'Write warnings like "15m", "1m" or "10s".')
  .refine(
    (v) => (parseDuration(v) ?? 0) <= MAX_WARNING_SECONDS,
    'Warnings can be at most 2 hours before.',
  )

/** A console command a schedule may run: no slash, and never `stop`. */
export const TaskCommand = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((c) => !c.startsWith('/'), 'Leave out the slash at the start.')
  .refine(
    (c) => !/^stop(\s|$)/i.test(c),
    'A scheduled "stop" would look like a crash. Use a restart task instead.',
  )
  .refine((c) => !/[\r\n]/.test(c), 'One command per task.')

export const TaskAnnouncement = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((c) => !/[\r\n]/.test(c), 'Keep announcements to one line.')

const RestartItem = z
  .object({
    restart: Cron.describe('When to restart, as a cron expression like "0 5 * * *".'),
    warn: z
      .array(Warning)
      .max(10)
      .optional()
      .describe(
        'When to warn players before, like ["15m", "5m", "1m", "10s"] (the default). [] for none.',
      ),
    skipWarningsWhenEmpty: z
      .boolean()
      .default(true)
      .describe('Restart straight away, without the countdown, when nobody is online.'),
  })
  .strict()

const CommandItem = z
  .object({
    command: TaskCommand.describe('A console command, without the slash.'),
    cron: Cron,
  })
  .strict()

const AnnounceItem = z
  .object({
    announce: TaskAnnouncement.describe('A message shown to everyone online, in chat.'),
    cron: Cron,
  })
  .strict()

export const ScheduleItem = z.union([RestartItem, CommandItem, AnnounceItem], {
  error:
    'Each schedule needs "restart" (a cron expression), or "command" or "announce" with "cron".',
})
export type ScheduleItem = z.output<typeof ScheduleItem>
export type ScheduleItemInput = z.input<typeof ScheduleItem>

export const Schedules = z
  .array(ScheduleItem)
  .max(50)
  .describe(
    'Restarts, commands and announcements on a schedule. The whole list is replaced; left out, it stays.',
  )

/** A task as Flytower stores and compares it. */
export interface TaskSpec {
  kind: TaskKind
  cron: string
  /** The command or announcement; null for a restart. */
  text: string | null
  /** Seconds before a restart to warn, longest first. */
  warn: number[]
  skipWhenEmpty: boolean
}

export function toTask(item: ScheduleItem): TaskSpec {
  if ('restart' in item) {
    const warn = (item.warn ?? DEFAULT_WARNINGS).map((w) => parseDuration(w)!)
    return {
      kind: 'restart',
      cron: item.restart,
      text: null,
      warn: [...new Set(warn)].sort((a, b) => b - a),
      skipWhenEmpty: item.skipWarningsWhenEmpty,
    }
  }
  if ('command' in item) {
    return { kind: 'command', cron: item.cron, text: item.command, warn: [], skipWhenEmpty: false }
  }
  return { kind: 'announce', cron: item.cron, text: item.announce, warn: [], skipWhenEmpty: false }
}

const defaultWarn = DEFAULT_WARNINGS.map((w) => parseDuration(w)!)
const sameWarn = (a: number[], b: number[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])

/** The task as a person would write it in a spec, defaults left out. */
export function toItem(task: TaskSpec): ScheduleItemInput {
  if (task.kind === 'restart') {
    return {
      restart: task.cron,
      ...(sameWarn(task.warn, defaultWarn) ? {} : { warn: task.warn.map(formatDuration) }),
      ...(task.skipWhenEmpty ? {} : { skipWarningsWhenEmpty: false }),
    }
  }
  if (task.kind === 'command') return { command: task.text ?? '', cron: task.cron }
  return { announce: task.text ?? '', cron: task.cron }
}

/** Same task, same settings. */
export function sameTask(a: TaskSpec, b: TaskSpec) {
  return (
    a.kind === b.kind &&
    a.cron === b.cron &&
    a.text === b.text &&
    sameWarn(a.warn, b.warn) &&
    a.skipWhenEmpty === b.skipWhenEmpty
  )
}

/** A short line for plans and lists, like "Restart at 0 5 * * *, warning 15m 5m 1m 10s". */
export function describeTask(task: TaskSpec): string {
  if (task.kind === 'restart') {
    const warn = task.warn.length ? `, warning ${task.warn.map(formatDuration).join(' ')}` : ''
    return `Restart (${task.cron})${warn}`
  }
  if (task.kind === 'command') return `Run "${task.text}" (${task.cron})`
  return `Announce "${task.text}" (${task.cron})`
}

/** A task as the Schedules tab sees it. */
export interface TaskView extends TaskSpec {
  id: number
  /** The next run, or null when the expression never matches again. */
  nextRunAt: string | null
  lastRunAt: string | null
  lastOk: boolean | null
  lastResult: string | null
  /** A command's reply, from its last run. */
  lastReply: string | null
  running: boolean
}

export interface SchedulesView {
  timezone: string
  tasks: TaskView[]
}
