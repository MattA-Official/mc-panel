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

function setup(opts: { running?: boolean; free?: number; saveReply?: string } = {}) {
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
  const service = new BackupService({
    db,
    backupsDir: join(base, 'backups'),
    serverDir: (n) => join(servers, n),
    agent,
    jobs: runner,
    rcon: async (_n, cmd) => {
      calls.push(`rcon ${cmd}`)
      return cmd === 'save-all flush' ? (opts.saveReply ?? 'Saved the game') : 'ok'
    },
    now: () => new Date((clock += 60_000)),
    freeBytes: async () => opts.free ?? 1e12,
    sleep: async () => {},
  })
  return { db, dir, base, service, calls, runner }
}

describe('backups', () => {
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

  it('skips RCON for a stopped server and refuses when the disk is full', async () => {
    const { service, calls } = setup({ free: 5 })
    expect((await service.backup('survival', 'manual').done).message).toContain(
      'Not enough disk space',
    )
    expect(calls.some((c) => c.startsWith('rcon'))).toBe(false)
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

  it('adopts stray files and forgets missing ones', async () => {
    const { service, base, db } = setup()
    await service.backup('survival', 'manual').done
    const folder = join(base, 'backups', 'survival')
    const [first] = await readdir(folder)
    writeFileSync(join(folder, 'survival-20250101T000000Z.tar.zst'), 'copied in')
    writeFileSync(join(folder, 'random.txt'), 'ignored')
    const listed = await service.list('survival')
    expect(listed.map((b) => b.file).sort()).toEqual(
      [first, 'survival-20250101T000000Z.tar.zst'].sort(),
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
