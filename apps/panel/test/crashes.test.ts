import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'bun:test'
import { openDb, schema, type Db } from '../server/db'
import {
  CrashMonitor,
  describeCrash,
  EXPECTED_GRACE_MS,
  type Status,
} from '../server/crashes/monitor'
import { findCrashReport, parseDescription, readLogTail } from '../server/crashes/files'
import type { NotifyEvent } from '../server/notify/types'

// What service.status returns, from `systemctl show` at each point in a server's life.
const up = (restarts = 0): Status => ({
  active: 'active',
  since: 'Mon 2026-11-09 21:00:00 UTC',
  result: 'success',
  restarts,
  exitKind: null,
  exitStatus: null,
})
/** Waiting out RestartSec after the process died. */
const autoRestart = (over: Partial<Status> = {}, restarts = 0): Status => ({
  active: 'activating',
  since: null,
  result: 'exit-code',
  restarts,
  exitKind: 'exited',
  exitStatus: 1,
  ...over,
})
const stopping: Status = { ...up(), active: 'deactivating' }
const stopped: Status = { ...up(), active: 'inactive', since: null }
const loopFailed: Status = {
  active: 'failed',
  since: null,
  result: 'start-limit-hit',
  restarts: 2,
  exitKind: 'exited',
  exitStatus: 1,
}

let db: Db
let root: string
let clock: number
let sent: { how: 'notify' | 'resolve'; e: NotifyEvent }[]
let starts: string[]
let restarts: string[]
let crashed: string[]
let mon: CrashMonitor

const dir = (s: string) => join(root, s)

beforeEach(() => {
  db = openDb(':memory:')
  root = mkdtempSync(join(tmpdir(), 'flytower-crash-'))
  mkdirSync(join(dir('survival'), 'logs'), { recursive: true })
  writeFileSync(
    join(dir('survival'), 'logs', 'latest.log'),
    '[21:00:00] [Server thread/INFO]: Done (3.1s)!\n[21:04:11] [Server thread/ERROR]: Encountered an unexpected exception\n',
  )
  clock = Date.parse('2026-11-09T21:00:00Z')
  sent = []
  starts = []
  restarts = []
  crashed = []
  mon = new CrashMonitor({
    db,
    serverDir: dir,
    notify: {
      notify: (e) => sent.push({ how: 'notify', e }),
      resolve: (e) => sent.push({ how: 'resolve', e }),
    },
    start: async (s) => void starts.push(s),
    restart: async (s) => void restarts.push(s),
    onCrash: (s) => void crashed.push(s),
    now: () => new Date(clock),
  })
})

const see = async (s: Status, server = 'survival') => {
  clock += 3000
  await mon.observe({ [server]: s })
}
const events = () => db.select().from(schema.serverEvents).all()
const audit = () => db.select().from(schema.audit).all()

describe('crash detection', () => {
  it('records a crash with its cause, the log tail and a notification', async () => {
    await see(up())
    await see(autoRestart())
    expect(mon.condition('survival')).toBe('crashed')
    const [e] = events()
    expect(e).toMatchObject({
      kind: 'crash',
      cause: 'It exited with code 1.',
      result: 'exit-code',
      exitStatus: 1,
    })
    expect(e!.logTail).toContain(
      '[21:04:11] [Server thread/ERROR]: Encountered an unexpected exception',
    )
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      how: 'notify',
      e: { kind: 'server.crashed', server: 'survival', severity: 'critical' },
    })
    expect(sent[0]!.e.detail).toContain('restarted automatically')
    expect(audit()).toMatchObject([{ action: 'server.crashed', target: 'survival', userId: null }])

    // The log watcher is told, so its "back up" waits until players can join.
    expect(crashed).toEqual(['survival'])
    // systemd brings it back; the banner stays until dismissed.
    await see(up(1))
    expect(mon.condition('survival')).toBeNull()
    expect(sent).toHaveLength(1)
    expect(mon.health(['survival']).survival!.crash).toMatchObject({ kind: 'crash' })
    expect(events().map((r) => r.kind)).toEqual(['crash', 'recovered'])
  })

  it('tells out-of-memory kills apart', async () => {
    await see(up())
    await see(autoRestart({ result: 'oom-kill', exitKind: 'killed', exitStatus: 9 }))
    expect(events()[0]).toMatchObject({ kind: 'oom', result: 'oom-kill' })
    expect(sent[0]!.e.title).toBe('Server ran out of memory')
  })

  it('never counts stops and restarts Flytower asked for', async () => {
    await see(up())
    const done = mon.expect('survival')
    await see(stopping)
    done()
    // The first look after the stop returned: it crashed on the way down (exit code 1).
    clock += 60_000
    await mon.observe({
      survival: {
        ...stopped,
        active: 'failed',
        result: 'exit-code',
        exitKind: 'exited',
        exitStatus: 1,
      },
    })
    await see(up())
    const again = mon.expect('survival')
    // A restart whose stop hit TimeoutStopSec.
    await see({
      ...stopped,
      active: 'failed',
      result: 'timeout',
      exitKind: 'killed',
      exitStatus: 9,
    })
    again()
    await see(up())
    expect(events()).toEqual([])
    expect(sent).toEqual([])
  })

  it('still counts a crash straight after a start or restart', async () => {
    await see(stopped)
    // Starts aren't marked: one that dies at once is a crash, often a bad mod.
    await see(up())
    await see(autoRestart())
    expect(events().map((e) => e.kind)).toEqual(['crash'])
    await see(up(1))
    const done = mon.expect('survival')
    await see(up(0))
    done()
    await see(up(0))
    clock += EXPECTED_GRACE_MS
    await see(autoRestart())
    expect(events().filter((e) => e.kind === 'crash')).toHaveLength(2)
  })

  it('treats a plain stop from the console as a stop, not a crash', async () => {
    await see(up())
    await see(stopped)
    expect(events()).toEqual([])
    expect(starts).toEqual([])
  })

  it('catches a crash it only saw the restart counter of', async () => {
    await see(up(0))
    clock += 60_000
    await see(up(1))
    expect(events().map((e) => e.kind)).toEqual(['crash', 'recovered'])
    expect(events()[0]!.cause).toBe('It stopped unexpectedly.')
    expect(sent.map((s) => s.how)).toEqual(['notify'])
    expect(crashed).toEqual(['survival'])
  })

  it("doesn't count a later console stop as the same crash again", async () => {
    await see(up(0))
    mkdirSync(join(dir('survival'), 'crash-reports'))
    const report = join(dir('survival'), 'crash-reports', 'crash-2026-11-09_21.00.30-server.txt')
    writeFileSync(report, 'Description: Ticking entity\n')
    const t = new Date(clock + 1000)
    utimesSync(report, t, t)
    clock += 60_000
    // Crashed, and systemd had it back up before the next look.
    await see(up(1))
    expect(events().filter((e) => e.kind === 'crash')).toHaveLength(1)
    clock += 30 * 60_000
    // Someone types `stop` in the console much later.
    await see(stopped)
    expect(events().filter((e) => e.kind === 'crash')).toHaveLength(1)
    expect(starts).toEqual([])
  })

  it('marks a crash loop when systemd gives up, and clears it on the next start', async () => {
    await see(up(0))
    await see(autoRestart({}, 0))
    await see(up(1))
    await see(autoRestart({}, 1))
    await see(up(2))
    await see(autoRestart({}, 2))
    await see(loopFailed)
    expect(mon.condition('survival')).toBe('crash-loop')
    expect(events().filter((e) => e.kind === 'crash')).toHaveLength(3)
    expect(events().at(-1)!.kind).toBe('crash-loop')
    expect(sent.find((s) => s.e.kind === 'server.crash_loop')).toMatchObject({
      how: 'notify',
      e: { severity: 'critical' },
    })
    expect(audit().map((a) => a.action)).toContain('server.crash_loop')
    expect(mon.health(['survival']).survival!.crash!.kind).toBe('crash-loop')

    // Start from the panel clears systemd's failed state; once it's up it's running again.
    const done = mon.expect('survival')
    await see(up(0))
    done()
    expect(mon.condition('survival')).toBeNull()
    expect(sent.filter((s) => s.how === 'resolve').map((s) => s.e.kind)).toContain(
      'server.crash_loop',
    )
  })

  it('counts a crash it missed while systemd was waiting to restart', async () => {
    await see(up(0))
    await see(autoRestart({}, 0))
    // Restarted and crashed again between two looks.
    await see(autoRestart({ exitStatus: 2 }, 1))
    expect(events().filter((e) => e.kind === 'crash')).toHaveLength(2)
  })

  it('picks up a crash loop that was already there when Flytower started, quietly', async () => {
    await see(loopFailed)
    expect(mon.condition('survival')).toBe('crash-loop')
    expect(sent).toEqual([])
    expect(events()).toEqual([])
  })

  it('links the crash report and uses its description', async () => {
    await see(up())
    mkdirSync(join(dir('survival'), 'crash-reports'))
    writeFileSync(
      join(dir('survival'), 'crash-reports', 'crash-2026-11-09_21.04.11-server.txt'),
      '---- Minecraft Crash Report ----\n// Uh... Did I do that?\n\nTime: 2026-11-09 21:04:11\nDescription: Exception ticking world\n\njava.lang.NullPointerException\n',
    )
    await see(autoRestart())
    expect(events()[0]).toMatchObject({
      crashReport: 'crash-reports/crash-2026-11-09_21.04.11-server.txt',
      cause: 'Minecraft crashed: Exception ticking world',
    })
    expect(mon.health(['survival']).survival!.crash!.crashReport).toBe(
      'crash-reports/crash-2026-11-09_21.04.11-server.txt',
    )
  })

  it('restarts a server that exited cleanly after writing a crash report', async () => {
    await see(up())
    mkdirSync(join(dir('survival'), 'crash-reports'))
    writeFileSync(
      join(dir('survival'), 'crash-reports', 'crash-2026-11-09_21.04.11-server.txt'),
      'Description: Watching Server\n',
    )
    await see(stopped)
    expect(events()[0]).toMatchObject({
      kind: 'crash',
      cause: 'Minecraft crashed: Watching Server',
    })
    expect(starts).toEqual(['survival'])
  })

  it('ignores crash reports from before the server started', async () => {
    mkdirSync(join(dir('survival'), 'crash-reports'))
    const old = join(dir('survival'), 'crash-reports', 'crash-2026-11-01_10.00.00-server.txt')
    writeFileSync(old, 'Description: Old news\n')
    const t = new Date('2026-11-01T10:00:00Z')
    utimesSync(old, t, t)
    await see(up())
    await see(stopped)
    expect(events()).toEqual([])
  })

  it('dismisses a banner, and forgets a deleted server', async () => {
    await see(up())
    await see(autoRestart())
    const id = mon.health(['survival']).survival!.crash!.id
    expect(mon.dismiss('survival', id)).toBe(true)
    expect(mon.health(['survival']).survival!.crash).toBeNull()
    expect(mon.dismiss('other', id)).toBe(false)
    mon.forget('survival')
    expect(events()).toEqual([])
    expect(mon.condition('survival')).toBeNull()
  })

  it('keeps 30 days of events', async () => {
    await see(up())
    await see(autoRestart())
    clock += 31 * 24 * 3600_000
    mon.prune()
    expect(events()).toEqual([])
  })

  it('tells watchers when the condition changes', async () => {
    const seen: string[] = []
    const off = mon.watch(
      (h) => seen.push(String(h.survival?.condition)),
      () => ['survival'],
    )
    await see(up())
    await see(autoRestart())
    await see(up(1))
    off()
    expect(seen).toEqual(['null', 'crashed', 'null'])
  })
})

describe('not responding', () => {
  it('waits for five missed minutes once the console has answered', async () => {
    await see(up())
    await mon.answered('survival', true)
    for (let i = 0; i < 4; i++) await mon.answered('survival', false)
    expect(mon.condition('survival')).toBeNull()
    await mon.answered('survival', false)
    expect(mon.condition('survival')).toBe('unresponsive')
    expect(events()[0]).toMatchObject({ kind: 'unresponsive' })
    expect(sent[0]).toMatchObject({ e: { kind: 'server.unresponsive', severity: 'warning' } })
    expect(restarts).toEqual([])

    await mon.answered('survival', true)
    expect(mon.condition('survival')).toBeNull()
    expect(sent.at(-1)).toMatchObject({ how: 'resolve', e: { kind: 'server.unresponsive' } })
  })

  it('gives a server that has never answered longer, for slow world loads', async () => {
    await see(up())
    for (let i = 0; i < 14; i++) await mon.answered('survival', false)
    expect(mon.condition('survival')).toBeNull()
    await mon.answered('survival', false)
    expect(mon.condition('survival')).toBe('unresponsive')
  })

  it('restarts it once when the setting is on', async () => {
    await see(up())
    await mon.answered('survival', true)
    for (let i = 0; i < 5; i++) await mon.answered('survival', false, true)
    expect(restarts).toEqual(['survival'])
    expect(sent[0]!.e.detail).toContain('Flytower is restarting it')
    expect(audit()).toMatchObject([{ action: 'server.unresponsive', detail: { restarted: true } }])

    // Still stuck after the restart: it stays marked, but isn't restarted a second time.
    await see(up())
    for (let i = 0; i < 15; i++) await mon.answered('survival', false, true)
    expect(restarts).toEqual(['survival'])
  })

  it('stops counting when the server stops', async () => {
    await see(up())
    await mon.answered('survival', true)
    for (let i = 0; i < 5; i++) await mon.answered('survival', false)
    await see(stopped)
    expect(mon.condition('survival')).toBeNull()
  })
})

describe('describeCrash', () => {
  it('names signals and core dumps', () => {
    expect(
      describeCrash({ result: 'signal', exitKind: 'killed', exitStatus: 9 }, null, []),
    ).toEqual({ kind: 'crash', cause: 'It was killed by SIGKILL.' })
    expect(
      describeCrash({ result: 'core-dump', exitKind: 'dumped', exitStatus: 6 }, null, []).cause,
    ).toBe('It was killed by SIGABRT and dumped core.')
  })

  it("spots Java's own out-of-memory error in the log", () => {
    expect(
      describeCrash({ result: 'exit-code', exitKind: 'exited', exitStatus: 1 }, null, [
        'java.lang.OutOfMemoryError: Java heap space',
      ]).kind,
    ).toBe('oom')
  })

  it('points at a JVM error file', () => {
    expect(
      describeCrash(
        { result: 'core-dump', exitKind: 'dumped', exitStatus: 6 },
        { path: 'hs_err_pid42.log', description: null, java: true },
        [],
      ).cause,
    ).toBe('Java itself crashed. The error file has the details.')
  })
})

describe('crash files', () => {
  it('reads the description from a report', () => {
    expect(parseDescription('Time: now\nDescription: Ticking entity\n')).toBe('Ticking entity')
    expect(parseDescription('nothing here')).toBeNull()
  })

  it('finds a JVM error file when there is no crash report', async () => {
    writeFileSync(join(dir('survival'), 'hs_err_pid42.log'), '# A fatal error')
    expect(await findCrashReport(dir('survival'), 0)).toEqual({
      path: 'hs_err_pid42.log',
      description: null,
      java: true,
    })
  })

  it('reads the last lines of a long log', async () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `line ${i}`)
    writeFileSync(join(dir('survival'), 'logs', 'latest.log'), lines.join('\n') + '\n')
    const tail = await readLogTail(dir('survival'))
    expect(tail).toHaveLength(50)
    expect(tail.at(-1)).toBe('line 2999')
    expect(await readLogTail(dir('nowhere'))).toEqual([])
  })
})
