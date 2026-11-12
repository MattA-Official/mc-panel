import { beforeEach, describe, expect, it } from 'bun:test'
import { BackupScheduler } from '../server/backups/scheduler'
import type { NotifyEvent } from '../server/notify/types'

describe('BackupScheduler', () => {
  let busy: boolean
  let waiters: (() => void)[]
  let started: string[]
  let sent: NotifyEvent[]
  let now: number
  let hold: boolean
  let scheduler: BackupScheduler

  beforeEach(() => {
    busy = false
    waiters = []
    started = []
    sent = []
    now = 0
    hold = false
    scheduler = new BackupScheduler(
      {
        isBusy: () => busy,
        whenFree: () => new Promise((r) => waiters.push(r)),
        backup: (name: string) => {
          if (busy) throw new Error('busy')
          started.push(name)
          return {
            jobId: 1,
            done: Promise.resolve({ state: 'succeeded' } as never),
          }
        },
      },
      undefined,
      {
        notify: { notify: (e) => sent.push(e) },
        now: () => now,
        sleep: (ms) => (hold ? new Promise(() => {}) : Promise.resolve(void (now += ms))),
        busyWaitMs: 10 * 60_000,
      },
    )
  })

  it('backs up straight away when the server is free', async () => {
    await scheduler.fire('survival')
    expect(started).toEqual(['survival'])
    expect(sent).toEqual([])
  })

  it('waits for a scheduled restart to let go, then backs up', async () => {
    busy = true
    hold = true
    const run = scheduler.fire('survival')
    await Bun.sleep(0)
    expect(started).toEqual([])
    busy = false
    for (const w of waiters.splice(0)) w()
    await run
    expect(started).toEqual(['survival'])
  })

  it('says so when the server stays busy for ten minutes', async () => {
    busy = true
    await scheduler.fire('survival')
    expect(started).toEqual([])
    expect(sent).toMatchObject([
      {
        kind: 'backup.failed',
        server: 'survival',
        title: 'A scheduled backup was skipped',
        severity: 'critical',
      },
    ])
  })
})
