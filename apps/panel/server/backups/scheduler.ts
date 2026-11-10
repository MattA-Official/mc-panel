/** Runs each server's backup schedule in-process with Bun.cron. */
import type { BackupService } from './service'

export interface Schedule {
  name: string
  backupSchedule: string | null
  backupTz: string
}

/** Throws a readable error for a bad expression or zone; returns the next run otherwise. */
export function nextRun(expr: string, tz: string, from = new Date()): Date | null {
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

export class BackupScheduler {
  private jobs = new Map<string, { key: string; job: Bun.CronJob }>()

  constructor(private service: Pick<BackupService, 'backup' | 'isBusy'>) {}

  /** Makes the running jobs match these schedules. Safe to call as often as you like. */
  sync(servers: Schedule[]) {
    const wanted = new Map(servers.filter((s) => s.backupSchedule).map((s) => [s.name, s] as const))
    for (const [name, entry] of this.jobs) {
      const s = wanted.get(name)
      if (!s || `${s.backupSchedule}|${s.backupTz}` !== entry.key) {
        entry.job.stop()
        this.jobs.delete(name)
      }
    }
    for (const [name, s] of wanted) {
      if (this.jobs.has(name)) continue
      try {
        const job = Bun.cron(s.backupSchedule!, () => this.fire(name), { tz: s.backupTz })
        job.unref()
        this.jobs.set(name, { key: `${s.backupSchedule}|${s.backupTz}`, job })
      } catch (err) {
        console.error(`[flytower] bad backup schedule for ${name}`, err)
      }
    }
  }

  scheduled() {
    return [...this.jobs.keys()]
  }

  private fire(name: string) {
    if (this.service.isBusy(name)) {
      console.log(`[flytower] skipped the scheduled backup of ${name}: it's busy`)
      return
    }
    try {
      void this.service.backup(name, 'scheduled').done.then((job) => {
        if (job.state === 'failed') {
          console.error(`[flytower] scheduled backup of ${name} failed: ${job.message}`)
        }
      })
    } catch (err) {
      console.error(`[flytower] scheduled backup of ${name} didn't start`, err)
    }
  }
}
