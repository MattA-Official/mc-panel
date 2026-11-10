import { beforeEach, describe, expect, it } from 'bun:test'
import { openDb, schema, type Db } from '../server/db'
import { parseSpec } from '../server/spec/yaml'
import { runRestart, warningCommands, warningTimeline } from '../server/schedules/restart'
import { ScheduleService } from '../server/schedules/service'
import { CronTimers } from '../server/schedules/timers'
import type { NotifyEvent } from '../server/notify/types'
import {
  describeCron,
  describeTask,
  parseDuration,
  ScheduleItem,
  spokenDuration,
  toItem,
  toTask,
  type TaskSpec,
} from '../shared/schedules'
import { compactSpec } from '../shared/spec'

const restartTask = (over: Partial<TaskSpec> = {}): TaskSpec => ({
  kind: 'restart',
  cron: '0 5 * * *',
  text: null,
  warn: [900, 300, 60, 10],
  skipWhenEmpty: true,
  ...over,
})

describe('durations', () => {
  it('reads and says them', () => {
    expect(parseDuration('15m')).toBe(900)
    expect(parseDuration('10s')).toBe(10)
    expect(parseDuration('1h')).toBe(3600)
    expect(parseDuration('0s')).toBeNull()
    expect(parseDuration('5 minutes')).toBeNull()
    expect(spokenDuration(60)).toBe('1 minute')
    expect(spokenDuration(300)).toBe('5 minutes')
    expect(spokenDuration(90)).toBe('90 seconds')
  })
})

describe('schedules in specs', () => {
  const spec = (body: string) =>
    parseSpec(`name: survival\nloader:\n  type: fabric\n  minecraft: '26.3'\n${body}`)

  it('reads restarts, commands and announcements', () => {
    const parsed = spec(`timezone: Europe/London
schedules:
  - restart: '0 5 * * *'
  - restart: '0 17 * * *'
    warn: [1m, 10s]
    skipWarningsWhenEmpty: false
  - command: save-all
    cron: '*/30 * * * *'
  - announce: 'Restart at 5am'
    cron: '0 22 * * *'
`)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues))
    const tasks = parsed.spec.schedules!.map(toTask)
    expect(tasks).toEqual([
      restartTask(),
      restartTask({ cron: '0 17 * * *', warn: [60, 10], skipWhenEmpty: false }),
      { kind: 'command', cron: '*/30 * * * *', text: 'save-all', warn: [], skipWhenEmpty: false },
      {
        kind: 'announce',
        cron: '0 22 * * *',
        text: 'Restart at 5am',
        warn: [],
        skipWhenEmpty: false,
      },
    ])
    expect(parsed.spec.timezone).toBe('Europe/London')
    // Written back, defaults are left out.
    expect(compactSpec(parsed.spec).schedules).toEqual([
      { restart: '0 5 * * *' },
      { restart: '0 17 * * *', warn: ['1m', '10s'], skipWarningsWhenEmpty: false },
      { command: 'save-all', cron: '*/30 * * * *' },
      { announce: 'Restart at 5am', cron: '0 22 * * *' },
    ])
  })

  it('refuses stop, slashes, bad warnings, bad cron and unknown zones', () => {
    const issues = (body: string) => {
      const p = spec(body)
      return p.ok ? [] : p.issues.map((i) => `${i.path}: ${i.message}`)
    }
    expect(issues(`schedules:\n  - command: stop\n    cron: '0 5 * * *'\n`)[0]).toContain(
      'schedules.0.command: A scheduled "stop"',
    )
    expect(issues(`schedules:\n  - command: /say hi\n    cron: '0 5 * * *'\n`)[0]).toContain(
      'Leave out the slash',
    )
    expect(issues(`schedules:\n  - restart: '0 5 * * *'\n    warn: [5x]\n`)[0]).toContain(
      'schedules.0.warn.0',
    )
    expect(issues(`schedules:\n  - restart: '0 5 * *'\n`)[0]).toContain(
      "schedules.0.restart: That schedule isn't valid",
    )
    expect(issues(`timezone: Mars/Olympus\n`)).toEqual([
      'timezone: Unknown time zone Mars/Olympus.',
    ])
  })

  it('round-trips a task through the spec form', () => {
    for (const t of [restartTask(), restartTask({ warn: [] })]) {
      expect(toTask(ScheduleItem.parse(toItem(t)))).toEqual(t)
    }
    expect(describeTask(restartTask())).toBe('Restart (0 5 * * *), warning 15m 5m 1m 10s')
  })
})

describe('the restart countdown', () => {
  it('times warnings back from the restart, leaving out ones already past', () => {
    const at = 1_000_000
    expect(warningTimeline(at, [10, 900, 60], at - 120_000)).toEqual([
      { seconds: 60, at: at - 60_000 },
      { seconds: 10, at: at - 10_000 },
    ])
  })

  it('puts the last seconds on screen too', () => {
    expect(warningCommands(300)).toEqual([
      'tellraw @a {"text":"Server restarting in 5 minutes","color":"gold"}',
    ])
    expect(warningCommands(10)).toHaveLength(3)
    expect(warningCommands(10)[2]).toBe('title @a title {"text":"Restarting","color":"gold"}')
  })

  function harness(players: number | null) {
    let now = Date.parse('2026-07-01T04:45:00Z')
    const log: string[] = []
    const deps = {
      now: () => now,
      sleep: async (ms: number) => void (now += ms),
      rcon: async (cmd: string) => {
        log.push(`${new Date(now).toISOString().slice(11, 19)} ${cmd}`)
        if (cmd === 'list') {
          if (players === null) throw new Error('no rcon')
          return `There are ${players} of a max of 20 players online: `
        }
        return ''
      },
      restart: async () => {
        log.push(`${new Date(now).toISOString().slice(11, 19)} RESTART`)
        now += 30_000
      },
    }
    return { deps, log }
  }

  it('warns at each time, saves, then restarts on the hour', async () => {
    const { deps, log } = harness(3)
    const out = await runRestart(deps, restartTask(), Date.parse('2026-07-01T05:00:00Z'))
    expect(log.filter((l) => !l.includes('title @a'))).toEqual([
      '04:45:00 list',
      '04:45:00 tellraw @a {"text":"Server restarting in 15 minutes","color":"gold"}',
      '04:55:00 tellraw @a {"text":"Server restarting in 5 minutes","color":"gold"}',
      '04:59:00 tellraw @a {"text":"Server restarting in 1 minute","color":"gold"}',
      '04:59:50 tellraw @a {"text":"Server restarting in 10 seconds","color":"gold"}',
      '05:00:00 save-all flush',
      '05:00:00 RESTART',
    ])
    expect(out).toEqual({ warned: 4, empty: false, tookSeconds: 30 })
  })

  it('skips the countdown when nobody is online', async () => {
    const { deps, log } = harness(0)
    const out = await runRestart(deps, restartTask(), Date.parse('2026-07-01T05:00:00Z'))
    expect(log).toEqual(['04:45:00 list', '04:45:00 save-all flush', '04:45:00 RESTART'])
    expect(out.empty).toBe(true)
  })

  it('counts down anyway when it is told to, or when it cannot tell', async () => {
    for (const [players, skip] of [
      [0, false],
      [null, true],
    ] as const) {
      const { deps } = harness(players)
      const out = await runRestart(
        deps,
        restartTask({ skipWhenEmpty: skip }),
        Date.parse('2026-07-01T05:00:00Z'),
      )
      expect(out.warned).toBe(4)
    }
  })
})

describe('ScheduleService', () => {
  let db: Db
  let now: number
  let busy: Set<string>
  let waiters: (() => void)[]
  let running: boolean
  let commands: string[]
  let restarts: number
  let failRestart: boolean
  /** Sleeps that never end on their own, to see a wait end by its event. */
  let hold: boolean
  let sent: { how: string; e: NotifyEvent }[]
  let service: ScheduleService

  beforeEach(() => {
    db = openDb(':memory:')
    db.insert(schema.users).values({ id: 1, name: 'Matt' }).run()
    db.insert(schema.servers)
      .values({
        name: 'survival',
        displayName: 'Survival',
        loader: 'vanilla',
        mcVersion: '26.3',
        javaMajor: 25,
        memoryMb: 2048,
        port: 25565,
        rconPort: 25575,
        rconPassword: 'x',
        eulaAcceptedAt: new Date(),
        timezone: 'Europe/London',
      })
      .run()
    now = Date.parse('2026-07-01T00:00:00Z')
    busy = new Set()
    waiters = []
    running = true
    commands = []
    restarts = 0
    failRestart = false
    hold = false
    sent = []
    const timers = new CronTimers({
      now: () => now,
      setTimer: () => 0,
      clearTimer: () => {},
    })
    service = new ScheduleService({
      db,
      timers,
      lock: {
        isBusy: (s) => busy.has(s),
        whenFree: () => new Promise((r) => waiters.push(r)),
        lock: (s) => {
          if (busy.has(s)) throw new Error('busy')
          busy.add(s)
          return () => {
            busy.delete(s)
            for (const w of waiters.splice(0)) w()
          }
        },
      },
      rcon: async (_s, cmd) => {
        commands.push(cmd)
        if (cmd === 'list') return 'There are 2 of a max of 20 players online: a, b'
        if (cmd === 'seed') return 'Seed: [42]'
        return ''
      },
      isRunning: async () => running,
      restart: async () => {
        if (failRestart) throw new Error('The server failed to start. Check its log.')
        restarts++
      },
      notify: {
        notify: (e) => sent.push({ how: 'notify', e }),
        resolve: (e) => sent.push({ how: 'resolve', e }),
      },
      now: () => now,
      sleep: (ms) => (hold ? new Promise(() => {}) : Promise.resolve(void (now += ms))),
      busyWaitMs: 10 * 60_000,
    })
  })

  const command = (text: string, cron = '*/30 * * * *'): TaskSpec => ({
    kind: 'command',
    cron,
    text,
    warn: [],
    skipWhenEmpty: false,
  })

  it('stores tasks in order, keeping the last run of ones that stay', async () => {
    service.replace('survival', [command('seed'), restartTask()], 'Europe/London')
    const [first] = service.view('survival').tasks
    await service.runNow('survival', first!.id, 1).done
    service.replace('survival', [restartTask(), command('seed'), command('say hi')])
    const view = service.view('survival')
    expect(view.timezone).toBe('Europe/London')
    expect(view.tasks.map((t) => [t.kind, t.text, t.lastResult])).toEqual([
      ['restart', null, null],
      ['command', 'seed', 'Ran'],
      ['command', 'say hi', null],
    ])
    // The next run is read in the server's zone: 05:00 London is 04:00 UTC in summer.
    expect(view.tasks[0]!.nextRunAt).toBe('2026-07-01T04:00:00.000Z')
  })

  it('runs a command and keeps its reply, in the activity log too', async () => {
    service.replace('survival', [command('seed')])
    const id = service.view('survival').tasks[0]!.id
    await service.runNow('survival', id, 1).done
    const t = service.view('survival').tasks[0]!
    expect(t).toMatchObject({ lastOk: true, lastResult: 'Ran', lastReply: 'Seed: [42]' })
    const audit = db.select().from(schema.audit).all()
    expect(audit).toMatchObject([
      { userId: 1, action: 'schedule.run', target: 'survival', detail: { ok: true } },
    ])
  })

  it('announces in gold', async () => {
    service.replace('survival', [
      {
        kind: 'announce',
        cron: '0 22 * * *',
        text: 'Restart at "5am"',
        warn: [],
        skipWhenEmpty: false,
      },
    ])
    await service.runNow('survival', service.view('survival').tasks[0]!.id, 1).done
    expect(commands).toEqual(['tellraw @a {"text":"Restart at \\"5am\\"","color":"gold"}'])
  })

  it('restarts after the countdown, holding the lock throughout', async () => {
    service.replace('survival', [restartTask({ warn: [60] })])
    const id = service.view('survival').tasks[0]!.id
    const run = service.runNow('survival', id, 1)
    expect(service.view('survival').tasks[0]!.running).toBe(true)
    await run.done
    expect(restarts).toBe(1)
    expect(busy.size).toBe(0)
    expect(service.view('survival').tasks[0]!).toMatchObject({
      running: false,
      lastOk: true,
      lastResult: 'Restarted in 0s (1 warning)',
    })
  })

  it("skips when the server isn't running, without an alert", async () => {
    running = false
    service.replace('survival', [restartTask()])
    await service.runNow('survival', service.view('survival').tasks[0]!.id, 1).done
    expect(restarts).toBe(0)
    expect(service.view('survival').tasks[0]!).toMatchObject({
      lastOk: null,
      lastResult: "Skipped: the server wasn't running",
    })
    expect(sent).toEqual([])
  })

  it('waits for a backup to finish, then runs', async () => {
    service.replace('survival', [command('seed')])
    busy.add('survival')
    hold = true
    const run = service.run(service.view('survival').tasks[0]!.id, now, null)
    await Bun.sleep(0)
    expect(commands).toEqual([])
    busy.delete('survival')
    for (const w of waiters.splice(0)) w()
    await run
    expect(commands).toEqual(['seed'])
  })

  it('gives up after ten minutes busy, and says so', async () => {
    service.replace('survival', [command('seed')])
    busy.add('survival')
    await service.run(service.view('survival').tasks[0]!.id, now, null)
    expect(commands).toEqual([])
    expect(service.view('survival').tasks[0]!).toMatchObject({
      lastOk: false,
      lastResult: 'Skipped: a backup or change was still running after 10 minutes',
    })
    expect(sent).toMatchObject([
      { how: 'notify', e: { kind: 'schedule.failed', server: 'survival', severity: 'warning' } },
    ])
  })

  it('reports a failed restart, then the all-clear after a good run', async () => {
    service.replace('survival', [restartTask({ warn: [] })])
    const id = service.view('survival').tasks[0]!.id
    failRestart = true
    await service.runNow('survival', id, 1).done
    expect(service.view('survival').tasks[0]!).toMatchObject({
      lastOk: false,
      lastResult: 'The server failed to start. Check its log.',
    })
    failRestart = false
    await service.runNow('survival', id, 1).done
    expect(sent.map((s) => s.how)).toEqual(['notify', 'resolve'])
    expect(
      db
        .select()
        .from(schema.audit)
        .all()
        .map((a) => a.userId),
    ).toEqual([1, 1])
  })

  it("won't start a task that is already running", async () => {
    service.replace('survival', [restartTask({ warn: [60] })])
    const id = service.view('survival').tasks[0]!.id
    const first = service.runNow('survival', id, 1)
    expect(() => service.runNow('survival', id, 1)).toThrow('already running')
    await first.done
  })
})

describe('describeCron', () => {
  it('says common schedules in words', () => {
    expect(describeCron('0 5 * * *')).toBe('Every day at 05:00')
    expect(describeCron('30 17 * * 0')).toBe('Every Sunday at 17:30')
    expect(describeCron('0 * * * *')).toBe('Every hour')
    expect(describeCron('15 * * * *')).toBe('Every hour at 15 past')
    expect(describeCron('0 */6 * * *')).toBe('Every 6 hours')
    expect(describeCron('*/30 * * * *')).toBe('Every 30 minutes')
    expect(describeCron('0 5 1 * *')).toBe('0 5 1 * *')
  })
})

describe('calling off a restart', () => {
  it('stops the countdown, tells players, and never restarts', async () => {
    let now = Date.parse('2026-07-01T04:45:00Z')
    const log: string[] = []
    let restarted = false
    const abort = new AbortController()
    const run = runRestart(
      {
        now: () => now,
        // Real time stands still; the countdown only moves when the test lets it.
        sleep: (ms) => new Promise((r) => setTimeout(() => r(void (now += ms)), 5)),
        rcon: async (cmd) => {
          log.push(cmd)
          return cmd === 'list' ? 'There are 1 of a max of 20 players online: a' : ''
        },
        restart: async () => void (restarted = true),
      },
      { warn: [900, 300], skipWhenEmpty: true },
      Date.parse('2026-07-01T05:00:00Z'),
      abort.signal,
    )
    await Bun.sleep(1)
    abort.abort()
    await expect(run).rejects.toThrow('Cancelled')
    expect(restarted).toBe(false)
    expect(log.at(-1)).toBe('tellraw @a {"text":"The restart has been called off","color":"gold"}')
  })
})
