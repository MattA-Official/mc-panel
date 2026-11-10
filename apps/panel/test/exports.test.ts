import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import type { Verb } from '@flytower/protocol'
import { ExportService, hashToken, worldFolderName } from '../server/backups/exports'
import { BackupService } from '../server/backups/service'
import { openDb, schema } from '../server/db'
import { JobRunner, type AgentCall } from '../server/jobs/runner'

function setup(opts: { running?: boolean; level?: string; noWorld?: boolean } = {}) {
  const db = openDb(':memory:')
  const base = mkdtempSync(join(tmpdir(), 'ft-exp-'))
  const dir = join(base, 'servers', 'survival')
  const level = opts.level ?? 'world'
  mkdirSync(join(dir, level, 'DIM-1'), { recursive: true })
  if (!opts.noWorld) writeFileSync(join(dir, level, 'level.dat'), 'level')
  writeFileSync(join(dir, level, 'DIM-1', 'r.mca'), 'nether')
  writeFileSync(join(dir, 'server.properties'), opts.level ? `level-name=${opts.level}\n` : '')
  db.insert(schema.users).values({ name: 'Matt' }).run()
  const calls: string[] = []
  const agent = (async (verb: Verb) => {
    if (verb === 'service.status') return { active: opts.running ? 'active' : 'inactive' }
    return {}
  }) as AgentCall
  const jobs = new JobRunner({
    db,
    agent,
    loaders: {} as never,
    fetch: (async () => new Response()) as never,
  })
  let clock = Date.UTC(2026, 10, 9, 12)
  const now = () => new Date(clock)
  const backups = new BackupService({
    db,
    backupsDir: join(base, 'backups'),
    serverDir: (n) => join(base, 'servers', n),
    agent,
    jobs,
    rcon: async (_n, c) => (calls.push(c), c === 'save-all flush' ? 'Saved the game' : ''),
    now,
    freeBytes: async () => 1e12,
  })
  const exports = new ExportService({
    db,
    exportsDir: join(base, 'exports'),
    serverDir: (n) => join(base, 'servers', n),
    backups,
    jobs,
    now,
  })
  return { db, dir, exports, calls, tick: (ms: number) => (clock += ms) }
}

describe('world export', () => {
  it('zips the world with saving paused, under the display name', async () => {
    const { exports, calls } = setup({ running: true })
    const job = await exports.export('survival', 'Weekend: Survival').done
    expect(job).toMatchObject({ state: 'succeeded' })
    expect(calls).toEqual(['save-off', 'save-all flush', 'save-on'])
    const [row] = exports.list('survival')
    const listing = Bun.spawnSync(['unzip', '-Z1', exports.path(row!)]).stdout.toString()
    expect(listing.split('\n').filter(Boolean)).toEqual([
      'Weekend Survival/',
      'Weekend Survival/DIM-1/',
      'Weekend Survival/DIM-1/r.mca',
      'Weekend Survival/level.dat',
    ])
  })

  it('follows level-name and refuses a world that was never made or escapes', async () => {
    expect((await setup({ level: 'smp' }).exports.export('survival', 'S').done).state).toBe(
      'succeeded',
    )
    const none = await setup({ noWorld: true }).exports.export('survival', 'S').done
    expect(none.message).toContain("There's no world")
    const sneaky = setup()
    writeFileSync(join(sneaky.dir, 'server.properties'), 'level-name=../../etc\n')
    const escape = await sneaky.exports.export('survival', 'S').done
    expect(escape.message).toContain('outside the server folder')
  })

  it('cleans up folder names', () => {
    expect(worldFolderName('  ../Our "Best"\tWorld?  ', 'world')).toBe('Our Best World')
    expect(worldFolderName('///', 'world')).toBe('world')
  })
})

describe('share links', () => {
  it('works until it expires, never outliving the export', async () => {
    const { exports, tick, db } = setup()
    await exports.export('survival', 'S').done
    const [row] = exports.list('survival')
    const { token, share } = exports.share('survival', row!.id, '24h', 1)
    expect(token).toHaveLength(43)
    expect(db.select().from(schema.shares).get()!.tokenHash).toBe(hashToken(token))
    expect(exports.redeem(token)?.id).toBe(row!.id)
    expect(exports.list('survival')[0]!.shares).toHaveLength(1)
    tick(25 * 3_600_000)
    expect(exports.redeem(token)).toBeNull()

    const week = exports.share('survival', row!.id, '7d', 1)
    expect(week.share.expiresAt.getTime()).toBe(row!.expiresAt.getTime())
    expect(share.downloads).toBe(0)
  })

  it('stops working when revoked or when the export is deleted', async () => {
    const { exports } = setup()
    await exports.export('survival', 'S').done
    const [row] = exports.list('survival')
    const a = exports.share('survival', row!.id, '1h', 1)
    const b = exports.share('survival', row!.id, '1h', 1)
    exports.revoke('survival', row!.id, a.share.id)
    expect(exports.redeem(a.token)).toBeNull()
    expect(exports.redeem(b.token)).not.toBeNull()
    await exports.remove('survival', row!.id)
    expect(exports.redeem(b.token)).toBeNull()
    expect(exports.redeem('not a token')).toBeNull()
  })

  it('sweeps expired exports', async () => {
    const { exports, tick } = setup()
    await exports.export('survival', 'S').done
    const path = exports.path(exports.list('survival')[0]!)
    tick(8 * 86_400_000)
    expect(await exports.sweep()).toBe(1)
    expect(await Bun.file(path).exists()).toBe(false)
  })
})

describe('past worlds', () => {
  it('keeps a world with its datapacks, never expires, and can be shared and renamed', async () => {
    const { exports, dir, tick } = setup()
    mkdirSync(join(dir, 'world', 'datapacks'))
    writeFileSync(join(dir, 'world', 'datapacks', 'graves.zip'), 'pack')
    const row = await exports.keepWorld('survival', join(dir, 'world'), '  2025–26   world ')
    expect(row.name).toBe('2025–26 world')
    const listing = Bun.spawnSync(['unzip', '-Z1', exports.path(row)]).stdout.toString()
    expect(listing).toContain('2025–26 world/datapacks/graves.zip')
    expect(listing).toContain('2025–26 world/level.dat')

    // Listed as a past world, not as a temporary export.
    expect(exports.list('survival')).toEqual([])
    expect(exports.pastWorlds('survival').map((w) => w.id)).toEqual([row.id])
    expect(exports.pastWorlds().map((w) => w.id)).toEqual([row.id])

    const { token, share } = exports.share('survival', row.id, '7d', 1)
    expect(share.expiresAt.getTime()).toBeGreaterThan(row.createdAt.getTime())
    tick(365 * 86_400_000)
    expect(await exports.sweep()).toBe(0)
    expect(exports.get('survival', row.id).id).toBe(row.id)
    expect(exports.redeem(token)).toBeNull() // the link ran out; the world didn't
    expect(exports.redeem(exports.share('survival', row.id, '1h', 1).token)?.id).toBe(row.id)

    expect(exports.renamePastWorld('survival', row.id, 'Season one').name).toBe('Season one')
    expect(() => exports.renamePastWorld('survival', row.id, '   ')).toThrow('Give the past')
    expect(() => exports.renamePastWorld('survival', row.id, 'x'.repeat(61))).toThrow('at most')
    expect(exports.pastWorld(row.id).name).toBe('Season one')
  })

  it("can't rename an ordinary export, and stays when the server is deleted", async () => {
    const { exports, dir } = setup()
    await exports.export('survival', 'S').done
    const [plain] = exports.list('survival')
    expect(() => exports.renamePastWorld('survival', plain!.id, 'x')).toThrow('No such past')
    expect(() => exports.pastWorld(plain!.id)).toThrow('No such past')
    const kept = await exports.keepWorld('survival', join(dir, 'world'), 'Old')
    await exports.removeAll('survival')
    expect(existsSync(exports.path(plain!))).toBe(false)
    expect(existsSync(exports.path(kept))).toBe(true)
    expect(exports.pastWorlds('survival')).toHaveLength(1)
  })
})
