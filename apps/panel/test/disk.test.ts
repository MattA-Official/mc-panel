import { linkSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { DiskUsage, groupOf, largestGroup, measure, measureServer } from '../server/disk'
import { diskLevel, type DiskReport } from '../shared/disk'

const KB = 1024

function tree() {
  const base = mkdtempSync(join(tmpdir(), 'ft-disk-'))
  const dirs = {
    serversDir: join(base, 'servers'),
    backupsDir: join(base, 'backups'),
    exportsDir: join(base, 'exports'),
    importsDir: join(base, 'imports'),
    archiveDir: join(base, 'archive'),
  }
  const file = (path: string, bytes: number) => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, Buffer.alloc(bytes, 1))
  }
  return { base, dirs, file }
}

/** Sizes on disk are whole blocks, so compare with some slack for directories. */
const about = (actual: number, expected: number) => {
  expect(actual).toBeGreaterThanOrEqual(expected)
  expect(actual).toBeLessThan(expected + 64 * KB)
}

describe('grouping', () => {
  it('puts each top-level entry in a group', () => {
    expect(groupOf('world', null)).toBe('world')
    expect(groupOf('world_nether', null)).toBe('world')
    expect(groupOf('logs', null)).toBe('logs')
    expect(groupOf('crash-reports', null)).toBe('logs')
    expect(groupOf('mods', null)).toBe('content')
    expect(groupOf('plugins', null)).toBe('content')
    expect(groupOf('config', null)).toBe('content')
    expect(groupOf('libraries', null)).toBe('other')
    expect(groupOf('server.jar', null)).toBe('other')
  })

  it('follows a custom level-name', () => {
    expect(groupOf('survival-2026', 'survival-2026')).toBe('world')
    expect(groupOf('survival-2026', null)).toBe('other')
    expect(groupOf('maps', 'maps/main')).toBe('world')
  })

  it('names the largest group', () => {
    const groups = { world: 5, backups: 9, exports: 0, logs: 1, content: 0, other: 0 }
    expect(largestGroup({ groups })).toBe('backups')
    expect(largestGroup({ groups: { ...groups, world: 0, backups: 0, logs: 0 } })).toBeNull()
  })
})

describe('measuring', () => {
  it("adds up files and doesn't follow symlinks", async () => {
    const { base, file } = tree()
    file(join(base, 'a', 'one'), 100 * KB)
    file(join(base, 'b', 'big'), 500 * KB)
    symlinkSync(join(base, 'b'), join(base, 'a', 'link'))
    about((await measure(join(base, 'a'))).bytes, 100 * KB)
  })

  it('counts a hard-linked file once', async () => {
    const { base, file } = tree()
    file(join(base, 'a', 'one'), 200 * KB)
    linkSync(join(base, 'a', 'one'), join(base, 'a', 'two'))
    about((await measure(join(base, 'a'))).bytes, 200 * KB)
  })

  it('treats a missing folder as empty', async () => {
    expect(await measure('/nonexistent/flytower')).toEqual({ bytes: 0, unreadable: 0 })
  })

  it.skipIf(process.getuid?.() === 0)('counts folders it cannot read', async () => {
    const { base, file } = tree()
    file(join(base, 'a', 'secret', 'x'), 10 * KB)
    chmodSync(join(base, 'a', 'secret'), 0o000)
    try {
      expect((await measure(join(base, 'a'))).unreadable).toBe(1)
    } finally {
      chmodSync(join(base, 'a', 'secret'), 0o755)
    }
  })

  it("splits a server's space into groups, with its backups and exports", async () => {
    const { dirs, file } = tree()
    const dir = join(dirs.serversDir, 'survival')
    file(join(dir, 'survival-2026', 'region', 'r.0.0.mca'), 400 * KB)
    file(join(dir, 'logs', 'latest.log'), 20 * KB)
    file(join(dir, 'mods', 'lithium.jar'), 60 * KB)
    file(join(dir, 'server.jar'), 80 * KB)
    file(join(dirs.backupsDir, 'survival', 'b.tar.zst'), 300 * KB)
    file(join(dirs.exportsDir, 'survival', 'w.zip'), 120 * KB)
    file(join(dirs.backupsDir, 'other', 'b.tar.zst'), 900 * KB)
    const s = await measureServer(
      {
        serverDir: (n) => join(dirs.serversDir, n),
        backupsDir: dirs.backupsDir,
        exportsDir: dirs.exportsDir,
        levelName: async () => 'survival-2026',
      },
      'survival',
      new Date(0),
    )
    about(s.groups.world, 400 * KB)
    about(s.groups.logs, 20 * KB)
    about(s.groups.content, 60 * KB)
    about(s.groups.other, 80 * KB)
    about(s.groups.backups, 300 * KB)
    about(s.groups.exports, 120 * KB)
    expect(s.bytes).toBe(Object.values(s.groups).reduce((a, b) => a + b, 0))
    expect(s.unreadable).toBe(0)
  })
})

describe('the tracker', () => {
  function setup(names = ['alpha', 'beta']) {
    const { dirs, file } = tree()
    for (const n of names) file(join(dirs.serversDir, n, 'world', 'level.dat'), 50 * KB)
    file(join(dirs.importsDir, 'x', 'upload.zip'), 70 * KB)
    let saved: DiskReport | null = null
    const live = [...names]
    const usage = new DiskUsage({
      names: () => live,
      serverDir: (n) => join(dirs.serversDir, n),
      ...dirs,
      levelName: async () => null,
      save: (r) => (saved = r),
      now: () => new Date(Date.UTC(2026, 10, 10)),
    })
    return { usage, dirs, file, live, saved: () => saved }
  }

  it('measures everything, and keeps the result', async () => {
    const { usage, saved } = setup()
    await usage.refresh()
    const r = usage.current()
    expect(r.servers.map((s) => s.server)).toEqual(['alpha', 'beta'])
    about(r.shared!.imports, 70 * KB)
    expect(r.measuring).toBe(false)
    expect(saved()?.servers).toHaveLength(2)
  })

  it('re-measures one server after a change', async () => {
    const { usage, dirs, file } = setup()
    await usage.refresh()
    const before = usage.server('alpha')!.groups.backups
    file(join(dirs.backupsDir, 'alpha', 'new.tar.zst'), 256 * KB)
    await usage.refresh('alpha')
    about(usage.server('alpha')!.groups.backups - before, 256 * KB)
  })

  it('folds requests made while measuring into the same run', async () => {
    const { usage } = setup()
    const a = usage.refresh()
    const b = usage.refresh('alpha')
    expect(a).toBe(b)
    await a
  })

  it('starts from the saved result and drops deleted servers', async () => {
    const { usage, live } = setup()
    await usage.refresh()
    live.splice(live.indexOf('beta'), 1)
    expect(usage.current().servers.map((s) => s.server)).toEqual(['alpha'])
    usage.forget('alpha')
    expect(usage.server('alpha')).toBeNull()
  })
})

describe('levels', () => {
  it('warns at 85% and is urgent at 95%', () => {
    expect(diskLevel(null)).toBe('ok')
    expect(diskLevel(84.9)).toBe('ok')
    expect(diskLevel(85)).toBe('warning')
    expect(diskLevel(95)).toBe('urgent')
  })
})
