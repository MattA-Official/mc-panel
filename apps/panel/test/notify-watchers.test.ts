import { describe, expect, it } from 'bun:test'
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseActivity, PlayerWatcher, RunningTracker } from '../server/notify/watchers'
import type { NotifyEvent } from '../server/notify/types'

describe('parseActivity', () => {
  it('reads joins and leaves from vanilla, Fabric and Paper logs', () => {
    expect(parseActivity('[12:34:56] [Server thread/INFO]: Steve joined the game')).toEqual({
      player: 'Steve',
      joined: true,
    })
    expect(parseActivity('[12:34:56 INFO]: Alex_2 left the game')).toEqual({
      player: 'Alex_2',
      joined: false,
    })
    expect(parseActivity('[12:34:56] [Server thread/INFO]: .BedrockGuy joined the game')).toEqual({
      player: '.BedrockGuy',
      joined: true,
    })
  })

  it('ignores chat and commands pretending to be joins', () => {
    expect(parseActivity('[12:34:56] [Server thread/INFO]: <Bob> Steve joined the game')).toBeNull()
    expect(
      parseActivity('[12:34:56] [Server thread/INFO]: [Server] Steve joined the game'),
    ).toBeNull()
    expect(parseActivity('[12:34:56] [Server thread/INFO]: Steve joined the game!')).toBeNull()
  })
})

describe('RunningTracker', () => {
  it('reports starts and stops after the first sample', () => {
    const notes: NotifyEvent[] = []
    const t = new RunningTracker({ notify: (e) => notes.push(e) })
    t.update({ survival: true, creative: false })
    expect(notes).toEqual([])
    t.update({ survival: true, creative: true })
    t.update({ creative: true }) // no answer for survival: nothing changes
    t.update({ survival: false, creative: true })
    expect(notes.map((n) => `${n.kind} ${n.server}`)).toEqual([
      'server.started creative',
      'server.stopped survival',
    ])
  })
})

describe('PlayerWatcher', () => {
  it('follows logs only while wanted, and only new lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ft-pw-'))
    const logs = join(dir, 'survival', 'logs')
    mkdirSync(logs, { recursive: true })
    const log = join(logs, 'latest.log')
    writeFileSync(log, '[10:00:00] [Server thread/INFO]: Old joined the game\n')
    const notes: NotifyEvent[] = []
    let wanted = false
    const w = new PlayerWatcher(
      { notify: (e) => notes.push(e), wants: (k) => wanted && k === 'player.joined' },
      dir,
      5,
    )
    w.sync(['survival'])
    expect(w.watching()).toEqual([])
    wanted = true
    w.sync(['survival'])
    expect(w.watching()).toEqual(['survival'])
    await Bun.sleep(30)
    appendFileSync(log, '[10:01:00] [Server thread/INFO]: Steve joined the game\n')
    await Bun.sleep(50)
    // Minecraft rotates the log when the server restarts.
    renameSync(log, join(logs, '2026-11-10-1.log'))
    writeFileSync(log, '[10:02:00] [Server thread/INFO]: Alex left the game\n')
    await Bun.sleep(50)
    expect(notes.map((n) => n.title)).toEqual(['Steve joined', 'Alex left'])
    expect(notes[0]).toMatchObject({ server: 'survival', link: '/servers/survival/players' })
    wanted = false
    w.sync(['survival'])
    expect(w.watching()).toEqual([])
    w.stop()
  })
})
