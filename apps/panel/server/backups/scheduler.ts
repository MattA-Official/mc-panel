/** Runs each server's backup schedule in-process, on the shared cron timers. */
import { CronTimers, nextRun } from '../schedules/timers'
import type { BackupService } from './service'

export { nextRun }

export interface Schedule {
  name: string
  backupSchedule: string | null
  backupTz: string
}

export class BackupScheduler {
  constructor(
    private service: Pick<BackupService, 'backup' | 'isBusy'>,
    private timers = new CronTimers(),
  ) {}

  /** Makes the running jobs match these schedules. Safe to call as often as you like. */
  sync(servers: Schedule[]) {
    this.timers.sync(
      servers
        .filter((s) => s.backupSchedule)
        .map((s) => ({
          key: s.name,
          cron: s.backupSchedule!,
          tz: s.backupTz,
          fire: () => this.fire(s.name),
        })),
    )
  }

  scheduled() {
    return this.timers.keys()
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
