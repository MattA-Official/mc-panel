import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import type { Verb } from '@flytower/protocol'
import { eq } from 'drizzle-orm'
import { BackupService } from '../server/backups/service'
import { openDb, schema } from '../server/db'
import { JobRunner, type AgentCall } from '../server/jobs/runner'
import type { NotifyEvent } from '../server/notify/types'

function setup(
  opts: {
    running?: boolean
    free?: number
    saveReply?: string
    rconDownFor?: number
    diskPercent?: number
  } = {},
) {
  const notes: NotifyEvent[] = []
  const db = openDb(':memory:')
  const base = mkdtempSync(join(tmpdir(), 'ft-bk-'))
  const servers = join(base, 'servers')
  const dir = join(servers, 'survival')
  mkdirSync(join(dir, 'world'), { recursive: true })
  mkdirSync(join(dir, 'logs'))
  writeFileSync(join(dir, 'world', 'level.dat'), 'version 1')
  writeFileSync(join(dir, 'logs', 'latest.log'), 'noise')
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
      keepLast: 2,
      keepDaily: 0,
      keepWeekly: 0,
    })
    .run()

  let state = opts.running ? 'active' : 'inactive'
  const calls: string[] = []
  const agent = (async (verb: Verb) => {
    calls.push(verb)
    if (verb === 'service.status') return { active: state, since: null }
    if (verb === 'service.stop') state = 'inactive'
    if (verb === 'service.start') state = 'active'
    return {}
  }) as AgentCall
  const runner = new JobRunner({
    db,
    agent,
    loaders: {} as never,
    fetch: (async () => new Response()) as never,
    sleep: async () => {},
  })
  let clock = Date.UTC(2026, 10, 9, 12)
  let rconDownFor = opts.rconDownFor ?? 0
  const service = new BackupService({
    db,
    backupsDir: join(base, 'backups'),
    serverDir: (n) => join(servers, n),
    agent,
    jobs: runner,
    rcon: async (_n, cmd) => {
      if (rconDownFor > 0) {
        rconDownFor--
        throw new Error("Couldn't connect to RCON on port 25575. Is the server running?")
      }
      calls.push(`rcon ${cmd}`)
      return cmd === 'save-all flush' ? (opts.saveReply ?? 'Saved the game') : 'ok'
    },
    now: () => new Date((clock += 60_000)),
    freeBytes: async () => opts.free ?? 1e12,
    diskPercent: () => opts.diskPercent ?? null,
    sleep: async () => {},
    notifier: {
      notify: (e) => notes.push(e),
      resolve: (e) => notes.push(e),
    },
  })
  return { db, dir, base, service, calls, runner, notes }
}

describe('backups', () => {
  it('waits for RCON on a server that has only just started', async () => {
    const { service, calls } = setup({ running: true, rconDownFor: 3 })
    await service.snapshot('survival', 'Before something')
    expect(calls.filter((c) => c.startsWith('rcon'))).toEqual([
      'rcon save-off',
      'rcon save-all flush',
      'rcon save-on',
    ])
  })

  it('pauses saving while a running server is archived', async () => {
    const { service, calls } = setup({ running: true })
    const final = await service.backup('survival', 'manual', 'before the update').done
    expect(final).toMatchObject({ state: 'succeeded' })
    expect(calls.filter((c) => c.startsWith('rcon'))).toEqual([
      'rcon save-off',
      'rcon save-all flush',
      'rcon save-on',
    ])
    const [b] = await service.list('survival')
    expect(b).toMatchObject({ kind: 'manual', note: 'before the update' })
    expect(b!.file).toMatch(/^survival-20261109T120100Z-manual\.tar\.zst$/)
  })

  it("turns saving back on even when the save isn't confirmed", async () => {
    const { service, calls } = setup({ running: true, saveReply: 'Saving failed' })
    const final = await service.backup('survival', 'manual').done
    expect(final.state).toBe('failed')
    expect(final.message).toContain("didn't confirm the save")
    expect(calls.at(-1)).toBe('rcon save-on')
    expect(await service.list('survival')).toEqual([])
  })

  it('tells people when a backup fails, and when backups work again', async () => {
    const { service, notes } = setup({ running: true, saveReply: 'Saving failed' })
    await service.backup('survival', 'scheduled').done
    expect(notes).toEqual([
      expect.objectContaining({
        kind: 'backup.failed',
        server: 'survival',
        severity: 'critical',
        title: 'A scheduled backup failed',
        detail: expect.stringContaining("didn't confirm the save"),
        link: '/servers/survival/world#backups',
      }),
    ])
  })

  it('skips RCON for a stopped server and refuses when the disk is full', async () => {
    const { service, calls } = setup({ free: 5 })
    expect((await service.backup('survival', 'manual').done).message).toContain(
      'Not enough disk space',
    )
    expect(calls.some((c) => c.startsWith('rcon'))).toBe(false)
  })

  it('skips scheduled backups when the disk is 95% full, but not manual ones', async () => {
    const { service, calls, notes } = setup({ running: true, diskPercent: 96.2 })
    const skipped = await service.backup('survival', 'scheduled').done
    expect(skipped.state).toBe('failed')
    expect(skipped.message).toStartWith('Skipped: the disk is 96% full')
    // Nothing was touched: saving was never paused.
    expect(calls.some((c) => c.startsWith('rcon'))).toBe(false)
    expect(notes).toEqual([
      expect.objectContaining({
        kind: 'backup.failed',
        title: 'A scheduled backup was skipped',
        detail: expect.stringContaining('96% full'),
      }),
    ])
    expect((await service.backup('survival', 'manual').done).state).toBe('succeeded')
  })

  it('runs scheduled backups as normal below 95%', async () => {
    const { service } = setup({ diskPercent: 94.9 })
    expect((await service.backup('survival', 'scheduled').done).state).toBe('succeeded')
  })

  it('allows one operation per server at a time', async () => {
    const { service } = setup()
    const first = service.backup('survival', 'manual')
    expect(() => service.backup('survival', 'manual')).toThrow('already running')
    await first.done
    await service.backup('survival', 'manual').done
  })

  it('prunes scheduled backups by retention but keeps manual ones', async () => {
    const { service } = setup()
    for (let i = 0; i < 4; i++) await service.backup('survival', 'scheduled').done
    await service.backup('survival', 'manual').done
    const kinds = (await service.list('survival')).map((b) => b.kind)
    expect(kinds).toEqual(['manual', 'scheduled', 'scheduled'])
  })

  it('never prunes kept backups, and they leave room for other safety copies', async () => {
    const { service } = setup()
    const kept = await service.snapshot('survival', 'Before resetting the world', { kept: true })
    for (let i = 0; i < 4; i++) await service.snapshot('survival', `safety ${i}`)
    let rows = await service.list('survival')
    expect(rows.find((b) => b.id === kept.id)?.kept).toBe(true)
    expect(rows.filter((b) => !b.kept)).toHaveLength(3)

    const scheduled = await service.backup('survival', 'scheduled').done
    expect(scheduled.state).toBe('succeeded')
    const first = (await service.list('survival')).find((b) => b.kind === 'scheduled')!
    service.setKept('survival', first.id, true)
    for (let i = 0; i < 3; i++) await service.backup('survival', 'scheduled').done
    rows = await service.list('survival')
    expect(rows.filter((b) => b.kind === 'scheduled')).toHaveLength(3)
    expect(rows.some((b) => b.id === first.id)).toBe(true)

    // Let go, retention deletes it on the next prune.
    service.setKept('survival', first.id, false)
    await service.prune('survival')
    expect((await service.list('survival')).some((b) => b.id === first.id)).toBe(false)
  })

  it('adopts stray files and forgets missing ones', async () => {
    const { service, base, db } = setup()
    await service.backup('survival', 'manual').done
    const folder = join(base, 'backups', 'survival')
    const [first] = await readdir(folder)
    writeFileSync(join(folder, 'survival-20250101T000000Z.tar.zst'), 'copied in')
    writeFileSync(join(folder, 'random.txt'), 'ignored')
    const listed = await service.list('survival')
    expect(listed.map((b) => b.file).sort()).toEqual(
      [first!, 'survival-20250101T000000Z.tar.zst'].sort(),
    )
    await Bun.$`rm ${join(folder, first!)}`
    expect(await service.list('survival')).toHaveLength(1)
    expect(db.select().from(schema.backups).all()).toHaveLength(1)
  })

  it('restores a backup, keeping a safety copy and restarting the server', async () => {
    const { service, dir, calls } = setup({ running: true })
    await service.backup('survival', 'manual').done
    const [b] = await service.list('survival')
    writeFileSync(join(dir, 'world', 'level.dat'), 'version 2 (griefed)')
    writeFileSync(join(dir, 'world', 'new-file'), 'should vanish')
    calls.length = 0

    const final = await service.restore('survival', b!.id).done
    expect(final).toMatchObject({ state: 'succeeded' })
    expect(readFileSync(join(dir, 'world', 'level.dat'), 'utf8')).toBe('version 1')
    expect(await readdir(join(dir, 'world'))).toEqual(['level.dat'])
    expect(calls).toContain('service.stop')
    expect(calls.at(-1)).toBe('service.status') // waited for it to come back
    const list = await service.list('survival')
    expect(list.map((x) => x.kind)).toEqual(['safety', 'manual'])
  })

  it('puts the folder back if the backup is unreadable', async () => {
    const { service, dir, base, db } = setup()
    await service.backup('survival', 'manual').done
    const [b] = await service.list('survival')
    writeFileSync(join(base, 'backups', 'survival', b!.file), 'corrupt')
    writeFileSync(join(dir, 'world', 'level.dat'), 'current')
    const final = await service.restore('survival', b!.id).done
    expect(final.state).toBe('failed')
    expect(final.message).toContain("Couldn't read the backup")
    expect(readFileSync(join(dir, 'world', 'level.dat'), 'utf8')).toBe('current')
    expect(
      db.select().from(schema.backups).where(eq(schema.backups.kind, 'safety')).all(),
    ).toHaveLength(1)
  })
})

describe('backup names', () => {
  it('two backups in the same second get different files', async () => {
    const { service, db } = setup()
    const fixed = new Date(Date.UTC(2026, 10, 9, 12))
    ;(service as unknown as { now: () => Date }).now = () => fixed
    await service.snapshot('survival', 'one')
    await service.snapshot('survival', 'two')
    const rows = db.select().from(schema.backups).all()
    expect(new Set(rows.map((r) => r.file)).size).toBe(2)
  })
})
