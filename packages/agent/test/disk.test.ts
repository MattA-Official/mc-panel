import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { dispatch } from '../src/dispatch'
import { measureInTs } from '../src/du'
import { handlers } from '../src/handlers'
import { groupOf } from '../src/handlers/disk'
import { fakeContext, fakeExec } from './fakes'

const KB = 1024

function file(path: string, bytes = 8 * KB) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, Buffer.alloc(bytes, 1))
}

/** A machine with one server, a few releases, Java, logs and caches, under a temp folder. */
function machine() {
  const root = mkdtempSync(join(tmpdir(), 'ft-disk-'))
  const prefix = join(root, 'opt')
  const data = join(root, 'data')
  const paths = {
    servers: join(root, 'srv'),
    runtimes: join(prefix, 'runtimes'),
    archive: join(data, 'archive'),
    config: join(root, 'etc'),
    systemd: join(root, 'systemd'),
    state: join(data, 'agent'),
    prefix,
    panelData: data,
    system: join(root, 'sys'),
  }
  const srv = join(paths.servers, 'survival')
  file(join(srv, 'server.properties'), 0)
  writeFileSync(join(srv, 'server.properties'), '# made by Flytower\nlevel-name=realm\n')
  file(join(srv, 'realm', 'level.dat'), 64 * KB)
  file(join(srv, 'logs', 'latest.log'))
  file(join(srv, 'mods', 'lithium.jar'), 32 * KB)
  file(join(srv, 'server.jar'), 16 * KB)
  symlinkSync('/etc', join(srv, 'escape'))
  file(join(data, 'backups', 'survival', 'one.zip'), 128 * KB)
  // A backup hard-linked to the world counts once, towards the world.
  linkSync(join(srv, 'realm', 'level.dat'), join(data, 'backups', 'survival', 'level.dat'))
  file(join(data, 'imports', 'upload.zip'))
  file(join(data, 'flytower.db'), 40 * KB)
  file(join(data, 'flytower.db.before-1.1.0'), 40 * KB)
  file(join(data, 'flytower.db.before-1.0.0'), 40 * KB)
  file(join(paths.runtimes, 'temurin-21', 'bin', 'java'), 96 * KB)
  for (const v of ['1.0.0', '1.1.0', '1.2.0']) {
    file(join(prefix, 'releases', v, 'VERSION'), 16)
    file(join(prefix, 'releases', v, 'bin', 'bun'), 48 * KB)
  }
  file(join(prefix, 'releases', '.download-1.3.0', 'part'))
  symlinkSync(join(prefix, 'releases', '1.2.0'), join(prefix, 'current'))
  file(join(paths.config, 'agent.env'), 1 * KB)
  file(join(paths.system, 'var/log/journal/system.journal'), 72 * KB)
  file(join(paths.system, 'var/log/syslog'))
  file(join(paths.system, 'var/cache/apt/archives/a.deb'), 24 * KB)
  file(join(paths.system, 'var/cache/apt/pkgcache.bin'))
  file(join(paths.system, 'tmp/scratch'))
  return { root, paths, srv }
}

const record = (state: string, from: string, to: string) => {
  mkdirSync(state, { recursive: true })
  writeFileSync(
    join(state, 'update.json'),
    JSON.stringify({
      state: 'succeeded',
      from,
      to,
      reason: null,
      at: new Date().toISOString(),
      manual: false,
    }),
  )
}

const size = async (...paths: string[]) =>
  (await measureInTs(paths)).reduce((a, m) => a + m.bytes, 0)

async function call(verb: string, params: unknown, ctx: ReturnType<typeof fakeContext>['ctx']) {
  return dispatch(JSON.stringify({ id: '1', verb, params }), handlers, ctx)
}

describe('which group a server folder entry is in', () => {
  const lines = readFileSync(
    join(import.meta.dir, '../../../protocol/fixtures/disk-groups.jsonl'),
    'utf8',
  )
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { entry: string; levelName: string | null; group: string })
  it.each(lines.map((l) => [`${l.entry} (level-name ${l.levelName})`, l] as const))(
    '%s',
    (_, l) => {
      expect(groupOf(l.entry, l.levelName)).toBe(l.group as ReturnType<typeof groupOf>)
    },
  )
})

describe('disk.usage', () => {
  it("splits a server's folder by group, with its backups, and never follows symlinks", async () => {
    const m = machine()
    const { ctx } = fakeContext(fakeExec().exec, undefined, m.paths)
    const res = await call('disk.usage', { servers: ['survival'], system: false }, ctx)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const r = res.result as {
      servers: Record<string, { groups: Record<string, number>; unreadable: number }>
      shared: unknown
      system: unknown
    }
    const s = r.servers.survival!
    expect(s.groups.world).toBe(await size(join(m.srv, 'realm')))
    expect(s.groups.logs).toBe(await size(join(m.srv, 'logs')))
    expect(s.groups.content).toBe(await size(join(m.srv, 'mods')))
    // server.jar and server.properties; the symlink to /etc counts for nothing.
    expect(s.groups.other).toBe(
      await size(join(m.srv, 'server.jar'), join(m.srv, 'server.properties')),
    )
    // The hard-linked level.dat is already counted in the world.
    expect(s.groups.backups).toBe(
      (await size(join(m.paths.panelData, 'backups', 'survival'))) -
        (await size(join(m.srv, 'realm', 'level.dat'))),
    )
    expect(s.groups.exports).toBe(0)
    expect(r.shared).toBeNull()
    expect(r.system).toBeNull()
  })

  it('measures the rest of the machine in parts, and what clean up would free', async () => {
    const m = machine()
    record(m.paths.state, '1.1.0', '1.2.0')
    const { ctx } = fakeContext(fakeExec().exec, undefined, m.paths)
    const res = await call('disk.usage', { servers: [], system: true }, ctx)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const r = res.result as {
      shared: { imports: number; archive: number }
      system: Record<string, number>
    }
    expect(r.shared.imports).toBe(await size(join(m.paths.panelData, 'imports')))
    expect(r.shared.archive).toBe(0)
    expect(r.system.java).toBe(await size(m.paths.runtimes))
    expect(r.system.logs).toBe(await size(join(m.paths.system, 'var/log')))
    expect(r.system.temp).toBe(
      await size(join(m.paths.system, 'var/cache/apt'), join(m.paths.system, 'tmp')),
    )
    expect(r.system.journal).toBe(await size(join(m.paths.system, 'var/log/journal')))
    expect(r.system.aptCache).toBe(
      await size(
        join(m.paths.system, 'var/cache/apt/archives'),
        join(m.paths.system, 'var/cache/apt/pkgcache.bin'),
      ),
    )
    // 1.0.0, the leftover download and 1.0.0's database copy.
    expect(r.system.oldReleases).toBe(
      await size(
        join(m.paths.prefix, 'releases', '1.0.0'),
        join(m.paths.prefix, 'releases', '.download-1.3.0'),
        join(m.paths.panelData, 'flytower.db.before-1.0.0'),
      ),
    )
    // Flytower: the prefix without runtimes, the config, and the data folder without the
    // servers' backups, imports and archive.
    const opt = await size(join(m.paths.prefix, 'releases'), join(m.paths.prefix, 'current'))
    const data = await size(
      join(m.paths.panelData, 'flytower.db'),
      join(m.paths.panelData, 'flytower.db.before-1.1.0'),
      join(m.paths.panelData, 'flytower.db.before-1.0.0'),
      m.paths.state,
    )
    expect(r.system.flytower).toBe(opt + data + (await size(m.paths.config)))
  })

  it('leaves out places that are missing', async () => {
    const m = machine()
    const { ctx } = fakeContext(fakeExec().exec, undefined, {
      ...m.paths,
      system: join(m.root, 'nowhere'),
    })
    const res = await call('disk.usage', { servers: ['creative'], system: true }, ctx)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const r = res.result as {
      servers: Record<string, { groups: Record<string, number> }>
      system: Record<string, number>
    }
    expect(Object.values(r.servers.creative!.groups).every((n) => n === 0)).toBe(true)
    expect(r.system.logs).toBe(0)
    expect(r.system.temp).toBe(0)
    expect(r.system.journal).toBe(0)
  })

  it('refuses paths', async () => {
    const m = machine()
    const { ctx } = fakeContext(fakeExec().exec, undefined, m.paths)
    const res = await call('disk.usage', { servers: ['../../etc'], system: false }, ctx)
    expect(res.ok).toBe(false)
  })
})

describe('clean up', () => {
  it('vacuums the journal to the size asked, and says what it freed', async () => {
    const m = machine()
    const journal = join(m.paths.system, 'var/log/journal/system.journal')
    const before = await size(journal)
    const { exec, calls } = fakeExec()
    const shrink: typeof exec = async (file, args) => {
      const r = await exec(file, args)
      if (file === 'journalctl') writeFileSync(journal, '')
      return r
    }
    const { ctx } = fakeContext(shrink, undefined, m.paths)
    const res = await call('disk.vacuum-journal', { maxMb: 200 }, ctx)
    expect(res).toEqual({ id: '1', ok: true, result: { freedBytes: before } })
    expect(calls.map((c) => [c.file, ...c.args].join(' '))).toEqual([
      'journalctl --vacuum-size=200M',
    ])
  })

  it('says when journalctl fails', async () => {
    const m = machine()
    const { exec } = fakeExec({ journalctl: { code: 1, stderr: 'no journal' } })
    const { ctx } = fakeContext(exec, undefined, m.paths)
    const res = await call('disk.vacuum-journal', { maxMb: 200 }, ctx)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.message).toContain('no journal')
  })

  it('cleans the apt cache, or says there is no apt', async () => {
    const m = machine()
    const { exec, calls } = fakeExec()
    const { ctx } = fakeContext(exec, undefined, m.paths)
    const res = await call('disk.clean-apt', {}, ctx)
    expect(res).toEqual({ id: '1', ok: true, result: { freedBytes: 0 } })
    expect(calls.map((c) => c.file + ' ' + c.args.join(' '))).toEqual(['apt-get clean'])

    const none = fakeContext(fakeExec({ 'apt-get': { code: 127 } }).exec, undefined, m.paths)
    const missing = await call('disk.clean-apt', {}, none.ctx)
    expect(missing.ok === false && missing.error.code).toBe('not_found')
  })

  it('keeps the running release and the one to go back to', async () => {
    const m = machine()
    record(m.paths.state, '1.1.0', '1.2.0')
    const releases = join(m.paths.prefix, 'releases')
    const expected = await size(
      join(releases, '1.0.0'),
      join(releases, '.download-1.3.0'),
      join(m.paths.panelData, 'flytower.db.before-1.0.0'),
    )
    const { ctx } = fakeContext(fakeExec().exec, undefined, m.paths)
    const res = await call('disk.prune-flytower', {}, ctx)
    expect(res).toEqual({
      id: '1',
      ok: true,
      result: {
        freedBytes: expected,
        removed: ['.download-1.3.0', '1.0.0', 'flytower.db.before-1.0.0'],
      },
    })
    expect(existsSync(join(releases, '1.0.0'))).toBe(false)
    expect(existsSync(join(releases, '1.1.0'))).toBe(true)
    expect(existsSync(join(releases, '1.2.0'))).toBe(true)
    expect(existsSync(join(m.paths.panelData, 'flytower.db.before-1.1.0'))).toBe(true)
    expect(existsSync(join(m.paths.panelData, 'flytower.db'))).toBe(true)
  })

  it('refuses while an update is running', async () => {
    const m = machine()
    mkdirSync(m.paths.state, { recursive: true })
    writeFileSync(
      join(m.paths.state, 'update.json'),
      JSON.stringify({
        state: 'running',
        from: '1.1.0',
        to: '1.2.0',
        reason: null,
        at: new Date().toISOString(),
        manual: false,
      }),
    )
    const { ctx } = fakeContext(fakeExec().exec, undefined, m.paths)
    const res = await call('disk.prune-flytower', {}, ctx)
    expect(res.ok === false && res.error.code).toBe('conflict')
    expect(existsSync(join(m.paths.prefix, 'releases', '1.0.0'))).toBe(true)
  })

  it('removes nothing when it cannot tell which release is running', async () => {
    const m = machine()
    const { ctx } = fakeContext(fakeExec().exec, undefined, {
      ...m.paths,
      prefix: join(m.root, 'elsewhere'),
    })
    const res = await call('disk.prune-flytower', {}, ctx)
    expect(res).toEqual({ id: '1', ok: true, result: { freedBytes: 0, removed: [] } })
  })
})
