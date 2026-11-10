/**
 * Cron timers for everything Flytower runs on a schedule: backups and scheduled tasks. Each
 * entry sleeps on one timer until its next run (worked out with Bun.cron.parse in the
 * entry's time zone), fires, then arms for the run after. Nothing polls.
 *
 * An entry can fire early by `leadMs`, so a restart at 05:00 can start warning players at
 * 04:45 and still restart on the hour.
 */

/** Throws a readable error for a bad expression or zone; returns the next run otherwise. */
export function nextRun(expr: string, tz: string, from: Date | number = new Date()): Date | null {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
  } catch {
    throw new Error(`Unknown time zone ${tz}.`)
  }
  try {
    return Bun.cron.parse(expr, from, { tz })
  } catch (err) {
    throw new Error(`That schedule isn't valid: ${(err as Error).message}`, { cause: err })
  }
}

export interface TimerEntry {
  /** Unique per entry, like `backup:survival` or `task:12`. */
  key: string
  cron: string
  tz: string
  /** Fire this long before each run. */
  leadMs?: number
  /** Called `leadMs` before `at`, the run's own time. */
  fire: (at: Date) => void
}

export interface Clock {
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

const realClock: Clock = {
  now: Date.now,
  setTimer: (fn, ms) => {
    const t = setTimeout(fn, ms)
    // Timers never keep the panel alive on their own.
    t.unref?.()
    return t
  },
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

/** setTimeout can't wait longer than about 24.8 days; longer waits are taken in steps. */
const MAX_WAIT_MS = 2 ** 31 - 1

interface Armed {
  signature: string
  entry: TimerEntry
  handle: unknown
  /** The run the timer is for. */
  at: Date | null
}

export class CronTimers {
  private armed = new Map<string, Armed>()

  constructor(private clock: Clock = realClock) {}

  /** Makes the armed timers match these entries. Safe to call as often as you like. */
  sync(entries: TimerEntry[]) {
    const wanted = new Map(entries.map((e) => [e.key, e] as const))
    for (const [key, a] of this.armed) {
      const e = wanted.get(key)
      if (!e || signature(e) !== a.signature) {
        this.clock.clearTimer(a.handle)
        this.armed.delete(key)
      } else {
        // Same schedule; pick up the newest callback without moving the timer.
        a.entry = e
      }
    }
    for (const [key, e] of wanted) {
      if (this.armed.has(key)) continue
      try {
        this.arm(e, this.clock.now())
      } catch (err) {
        console.error(`[flytower] bad schedule for ${key}`, err)
      }
    }
  }

  /** Keys of the entries that are armed. */
  keys() {
    return [...this.armed.keys()]
  }

  /** When an entry runs next (its own time, not the early start), or null. */
  next(key: string): Date | null {
    return this.armed.get(key)?.at ?? null
  }

  stopAll() {
    for (const a of this.armed.values()) this.clock.clearTimer(a.handle)
    this.armed.clear()
  }

  /** Arms for the first run whose early start is after `from`. */
  private arm(entry: TimerEntry, from: number) {
    const lead = entry.leadMs ?? 0
    const at = nextRun(entry.cron, entry.tz, from + lead)
    const a: Armed = { signature: signature(entry), entry, handle: null, at }
    this.armed.set(entry.key, a)
    if (!at) return
    this.wait(a, at)
  }

  private wait(a: Armed, at: Date) {
    const fireAt = at.getTime() - (a.entry.leadMs ?? 0)
    const ms = fireAt - this.clock.now()
    if (ms > MAX_WAIT_MS) {
      a.handle = this.clock.setTimer(() => this.wait(a, at), MAX_WAIT_MS)
      return
    }
    a.handle = this.clock.setTimer(
      () => {
        if (this.armed.get(a.entry.key) !== a) return
        // Arm the next run first, so a slow or failing task can't lose its schedule.
        try {
          this.arm(a.entry, Math.max(this.clock.now(), fireAt) + 1000)
        } catch (err) {
          console.error(`[flytower] couldn't re-arm ${a.entry.key}`, err)
        }
        try {
          a.entry.fire(at)
        } catch (err) {
          console.error(`[flytower] ${a.entry.key} failed to start`, err)
        }
      },
      Math.max(0, ms),
    )
  }
}

function signature(e: TimerEntry) {
  return `${e.cron}|${e.tz}|${e.leadMs ?? 0}`
}
