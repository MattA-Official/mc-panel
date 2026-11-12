/** Runs each server's backup schedule in-process, on the shared cron timers. */
import { BUSY_WAIT_MS } from '../../shared/schedules'
import type { Notifier } from '../notify/types'
import { CronTimers, nextRun } from '../schedules/timers'
import type { BackupService } from './service'

export { nextRun }

export interface Schedule {
  name: string
  backupSchedule: string | null
  backupTz: string
}

export interface SchedulerOptions {
  /** Told when a scheduled backup can't start because the server stayed busy. */
  notify?: Pick<Notifier, 'notify'>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** How long to wait for a restart, restore or change to finish. Ten minutes by default. */
  busyWaitMs?: number
}

export class BackupScheduler {
  private now: () => number
  private sleep: (ms: number) => Promise<void>

  constructor(
    private service: Pick<BackupService, 'backup' | 'isBusy' | 'whenFree'>,
    private timers = new CronTimers(),
    private opts: SchedulerOptions = {},
  ) {
    this.now = opts.now ?? Date.now
    this.sleep = opts.sleep ?? ((ms) => Bun.sleep(ms))
  }

  /** Makes the running jobs match these schedules. Safe to call as often as you like. */
  sync(servers: Schedule[]) {
    this.timers.sync(
      servers
        .filter((s) => s.backupSchedule)
        .map((s) => ({
          key: s.name,
          cron: s.backupSchedule!,
          tz: s.backupTz,
          fire: () => void this.fire(s.name),
        })),
    )
  }

  scheduled() {
    return this.timers.keys()
  }

  /**
   * Backs the server up, first waiting for anything else holding its lock (a scheduled
   * restart, say) to finish. Says so if it never does.
   */
  async fire(name: string) {
    const waitMs = this.opts.busyWaitMs ?? BUSY_WAIT_MS
    const deadline = this.now() + waitMs
    while (this.service.isBusy(name)) {
      const left = deadline - this.now()
      if (left <= 0) {
        const minutes = Math.round(waitMs / 60_000)
        console.log(`[flytower] skipped the scheduled backup of ${name}: busy for ${minutes}m`)
        this.opts.notify?.notify({
          kind: 'backup.failed',
          server: name,
          title: 'A scheduled backup was skipped',
          detail: `A restart, restore or change was still running after ${minutes} minutes.`,
          severity: 'critical',
          link: `/servers/${name}/world#backups`,
        })
        return
      }
      await Promise.race([this.service.whenFree(name), this.sleep(left)])
    }
    try {
      // Nothing awaits between the busy check and this, so the lock is still free.
      const job = await this.service.backup(name, 'scheduled').done
      if (job.state === 'failed') {
        console.error(`[flytower] scheduled backup of ${name} failed: ${job.message}`)
      }
    } catch (err) {
      console.error(`[flytower] scheduled backup of ${name} didn't start`, err)
    }
  }
}
