import { describe, expect, it } from 'bun:test'
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LogWatcher, parseLogLine, RESTART_WINDOW_MS, SETTLE_MS } from '../server/notify/watchers'
import type { NotifyEvent } from '../server/notify/types'

const line = (msg: string) => `[12:34:56] [Server thread/INFO]: ${msg}`

/** Waits until `check` passes, for events that arrive through inotify. */
async function until(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms
  while (!check() && Date.now() < end) await Bun.sleep(10)
}

describe('parseLogLine', () => {
  it('reads joins and leaves from vanilla, Fabric and Paper logs', () => {
    expect(parseLogLine(line('Steve joined the game'))).toEqual({
      kind: 'joined',
      player: 'Steve',
    })
    expect(parseLogLine('[12:34:56 INFO]: Alex_2 left the game')).toEqual({
      kind: 'left',
      player: 'Alex_2',
    })
    expect(parseLogLine(line('.BedrockGuy joined the game'))).toEqual({
      kind: 'joined',
      player: '.BedrockGuy',
    })
  })

  it('reads the server being ready and stopping', () => {
    expect(parseLogLine(line('Done (12.345s)! For help, type "help"'))).toEqual({ kind: 'ready' })
    expect(parseLogLine('[12:34:56 INFO]: Done (3,21s)! For help, type "help" or "?"')).toEqual({
      kind: 'ready',
    })
    expect(parseLogLine(line('Stopping the server'))).toEqual({ kind: 'stopping' })
    expect(parseLogLine('[12:34:56 INFO]: Stopping server')).toEqual({ kind: 'stopping' })
  })

  it('ignores chat and commands pretending to be events', () => {
    expect(parseLogLine(line('<Bob> Steve joined the game'))).toBeNull()
    expect(parseLogLine(line('[Server] Steve joined the game'))).toBeNull()
    expect(parseLogLine(line('Steve joined the game!'))).toBeNull()
    expect(parseLogLine(line('[Server] Stopping the server'))).toBeNull()
    expect(parseLogLine(line('<Bob> Done (1s)! For help, type "help"'))).toBeNull()
  })
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ft-lw-'))
  const notes: NotifyEvent[] = []
  const resolved: NotifyEvent[] = []
  let now = 1_000_000
  const w = new LogWatcher(
    { notify: (e) => notes.push(e), resolve: (e) => resolved.push(e) },
    dir,
    () => now,
  )
  return { dir, notes, resolved, w, tick: (ms: number) => (now += ms) }
}

describe('LogWatcher', () => {
  it('hears new lines without polling, through log rotation, and not old ones', async () => {
    const { dir, notes, w } = setup()
    const logs = join(dir, 'survival', 'logs')
    mkdirSync(logs, { recursive: true })
    const log = join(logs, 'latest.log')
    writeFileSync(log, `${line('Old joined the game')}\n`)
    w.sync(['survival'])
    expect(w.watching()).toEqual(['survival'])
    await Bun.sleep(50)
    appendFileSync(log, `${line('Steve joined the game')}\n`)
    await until(() => notes.length === 1)
    // Minecraft rotates the log when the server starts again.
    renameSync(log, join(logs, '2026-11-10-1.log'))
    writeFileSync(
      log,
      `${line('Stopping the server')}\n${line('Done (2.1s)! For help, type "help"')}\n`,
    )
    await until(() => notes.length === 3)
    expect(notes.map((n) => n.title)).toEqual(['Steve joined', 'Server stopping', 'Server started'])
    expect(notes[0]).toMatchObject({ server: 'survival', link: '/servers/survival/players' })
    expect(notes.map((n) => n.kind)).toEqual(['player.joined', 'server.stopped', 'server.started'])
    w.sync([])
    expect(w.watching()).toEqual([])
    w.stop()
  })

  it('hears a join written straight after the login line', async () => {
    // Minecraft writes these two lines under a millisecond apart and then often nothing more
    // for minutes. Bun's watcher can fold the second change into the first, so it's tried a
    // few times over, each on its own quiet log.
    for (let i = 0; i < 8; i++) {
      const { dir, notes, w } = setup()
      const logs = join(dir, 'survival', 'logs')
      mkdirSync(logs, { recursive: true })
      const log = join(logs, 'latest.log')
      writeFileSync(log, '')
      w.sync(['survival'])
      await Bun.sleep(30)
      appendFileSync(
        log,
        `${line('Steve[/203.0.113.7:51234] logged in with entity id 7 at (0.5, 64.0, 0.5)')}\n`,
      )
      const t = performance.now()
      while (performance.now() - t < 0.5) {
        // The server thread is busy for a moment between the two lines.
      }
      await Bun.sleep(0.5)
      appendFileSync(log, `${line('Steve joined the game')}\n`)
      await until(() => notes.length === 1, SETTLE_MS * 4)
      expect(notes.map((n) => n.title)).toEqual(['Steve joined'])
      w.stop()
    }
  }, 15_000)

  it('picks up a server that has never run once its logs folder appears', async () => {
    const { dir, notes, w } = setup()
    mkdirSync(join(dir, 'fresh'))
    w.sync(['fresh'])
    await Bun.sleep(50)
    mkdirSync(join(dir, 'fresh', 'logs'))
    writeFileSync(
      join(dir, 'fresh', 'logs', 'latest.log'),
      `${line('Done (9.0s)! For help, type "help"')}\n`,
    )
    await until(() => notes.length === 1)
    expect(notes.map((n) => n.title)).toEqual(['Server started'])
    w.stop()
  })

  it('announces a restart, hides its stop, and says when it is back', () => {
    const { notes, w, tick } = setup()
    w.restartPressed('survival')
    w.lines('survival', [line('Stopping the server'), line('Done (5s)! For help, type "help"')])
    expect(notes.map((n) => `${n.kind}: ${n.title}`)).toEqual([
      'server.restarted: Server restarting',
      'server.restarted: Server restarted',
    ])
    // Afterwards, stops are stops again.
    w.lines('survival', [line('Stopping the server')])
    expect(notes.at(-1)?.title).toBe('Server stopping')
    // A restart that never comes back is forgotten.
    w.restartPressed('survival')
    tick(RESTART_WINDOW_MS + 1)
    w.lines('survival', [line('Stopping the server')])
    expect(notes.at(-1)?.title).toBe('Server stopping')
    // And one that failed straight away too.
    w.restartPressed('survival')
    w.restartFailed('survival')
    w.lines('survival', [line('Done (5s)! For help, type "help"')])
    expect(notes.at(-1)?.title).toBe('Server started')
  })

  it('says a crashed server is back up once players can join, not that it started', () => {
    const { notes, resolved, w } = setup()
    w.crashed('survival')
    w.lines('survival', [line('Done (5s)! For help, type "help"')])
    expect(notes).toEqual([])
    expect(resolved).toMatchObject([
      { kind: 'server.crashed', title: 'Server is back up', severity: 'ok' },
    ])
    // The next start is an ordinary start again.
    w.lines('survival', [line('Done (5s)! For help, type "help"')])
    expect(notes.at(-1)?.title).toBe('Server started')
  })

  it("restarts quietly for a server that stopped responding, then says it's back", () => {
    const { notes, w } = setup()
    w.restartPressed('survival', false)
    w.lines('survival', [line('Stopping the server'), line('Done (5s)! For help, type "help"')])
    expect(notes.map((n) => n.title)).toEqual(['Server restarted'])
  })
})
