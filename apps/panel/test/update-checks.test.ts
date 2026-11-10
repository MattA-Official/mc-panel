import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../server/db'
import { compareJava, installedRuntimes, latestTemurin } from '../server/java-updates'
import {
  checkCron,
  findMinecraftUpdate,
  UpdateChecker,
  type CheckSources,
  type Scope,
} from '../server/update-checks'
import { failedCheck, serverUpdateCount, systemUpdateCount } from '../shared/updates'

function setup(over: Partial<CheckSources> = {}) {
  const db = openDb(':memory:')
  let clock = Date.parse('2026-11-10T12:00:00Z')
  const found: [Scope, string, unknown][] = []
  let servers = [
    { name: 'survival', javaMajor: 21 },
    { name: 'creative', javaMajor: 25 },
  ]
  const sources: CheckSources = {
    flytower: async () => ({
      current: '1.1.0-beta.5',
      latest: { version: '1.1.0', prerelease: false, url: 'https://x/v1.1.0' },
    }),
    content: async (s) => ({
      updates: s === 'survival' ? [{ label: 'Lithium', from: '0.18.0', to: '0.18.1' }] : [],
    }),
    minecraft: async (s) => ({ current: '26.3', newest: null, ready: null, missing: [s] }),
    runtimes: async () => [
      { major: 21, version: '21.0.5+11.0.LTS' },
      { major: 25, version: '25.0.1+8' },
    ],
    latestJava: async (major) => (major === 21 ? '21.0.6+7' : '25.0.1+8.0.LTS'),
    servers: () => servers,
    ...over,
  }
  const checker = new UpdateChecker({
    db,
    sources,
    found: (scope, subject, summary) => found.push([scope, subject, summary]),
    now: () => clock,
  })
  return {
    db,
    checker,
    found,
    tick: (ms: number) => (clock += ms),
    setServers: (s: typeof servers) => (servers = s),
  }
}

describe('update checker', () => {
  it('checks everything and keeps the results', async () => {
    const { checker, found } = setup()
    await checker.checkAll()
    const s = checker.snapshot()
    expect(s.flytower?.summary?.latest?.version).toBe('1.1.0')
    expect(serverUpdateCount(s, 'survival')).toBe(1)
    expect(serverUpdateCount(s, 'creative')).toBe(0)
    expect(s.servers.survival?.minecraft?.summary?.missing).toEqual(['survival'])
    expect(s.java.map((j) => [j.summary?.major, j.summary?.latest])).toEqual([
      [21, '21.0.6+7'],
      [25, null],
    ])
    expect(s.java[0]?.summary?.servers).toEqual(['survival'])
    // Flytower and Java 21.
    expect(systemUpdateCount(s)).toBe(2)
    expect(s.lastRunAt).toBe('2026-11-10T12:00:00.000Z')
    expect(found.map(([scope, subject]) => `${scope}:${subject}`)).toEqual([
      'flytower:*',
      'content:survival',
      'minecraft:survival',
      'content:creative',
      'minecraft:creative',
      'java:21',
      'java:25',
    ])
  })

  it('keeps the last good result when a check fails', async () => {
    let down = false
    const { checker, tick } = setup({
      content: async () => {
        if (down) throw new Error('Modrinth answered 503')
        return { updates: [{ label: 'Lithium', from: '1', to: '2' }] }
      },
    })
    await checker.checkAll()
    down = true
    tick(60_000)
    await checker.checkAll()
    const c = checker.snapshot().servers.survival!.content!
    expect(c.summary?.updates).toHaveLength(1)
    expect(c.checkedAt).toBe('2026-11-10T12:00:00.000Z')
    expect(c.error).toBe('Modrinth answered 503')
    expect(c.errorAt).toBe('2026-11-10T12:01:00.000Z')
    expect(failedCheck([c])).toEqual({
      error: 'Modrinth answered 503',
      at: '2026-11-10T12:01:00.000Z',
    })
    // Back up: the error clears.
    down = false
    await checker.checkAll()
    expect(checker.snapshot().servers.survival!.content!.error).toBeNull()
  })

  it("doesn't tell anyone about a failed check", async () => {
    const { checker, found } = setup({
      flytower: async () => {
        throw new Error('GitHub answered 500')
      },
    })
    await checker.checkAll()
    expect(found.some(([scope]) => scope === 'flytower')).toBe(false)
    expect(checker.snapshot().flytower?.summary).toBeNull()
    expect(checker.snapshot().flytower?.error).toBe('GitHub answered 500')
  })

  it('runs one check at a time', async () => {
    let calls = 0
    const { checker } = setup({
      flytower: async () => {
        calls++
        await Bun.sleep(5)
        return { current: '1.0.0', latest: null }
      },
    })
    const a = checker.checkAll()
    expect(checker.checking()).toBe(true)
    const b = checker.checkAll()
    await Promise.all([a, b])
    expect(calls).toBe(1)
    expect(checker.checking()).toBe(false)
  })

  it('checks on open only when the last check is over an hour old', async () => {
    const { checker, tick } = setup()
    expect(checker.maybeCheck(3600_000)).toBe(true)
    await checker.checkAll()
    tick(30 * 60_000)
    expect(checker.maybeCheck(3600_000)).toBe(false)
    tick(31 * 60_000)
    expect(checker.maybeCheck(3600_000)).toBe(true)
    await checker.checkAll()
  })

  it('remembers when it last ran across restarts', async () => {
    const { db, checker } = setup()
    await checker.checkAll()
    const again = new UpdateChecker({
      db,
      sources: { servers: () => [] } as unknown as CheckSources,
      now: () => Date.parse('2026-11-10T12:30:00Z'),
    })
    expect(again.lastRunAt()).toBe(Date.parse('2026-11-10T12:00:00Z'))
    expect(again.maybeCheck(3600_000)).toBe(false)
  })

  it('forgets deleted servers and removed runtimes', async () => {
    const { checker, setServers } = setup()
    await checker.checkAll()
    setServers([{ name: 'survival', javaMajor: 21 }])
    await checker.checkAll()
    expect(Object.keys(checker.snapshot().servers)).toEqual(['survival'])
    checker.forget('survival')
    expect(checker.snapshot().servers.survival).toEqual({ content: null, minecraft: null })
  })

  it('tells listeners about each change', async () => {
    const { checker } = setup()
    const seen: boolean[] = []
    const off = checker.watch((s) => seen.push(s.checking))
    await checker.checkAll()
    off()
    expect(seen[0]).toBe(false)
    expect(seen[1]).toBe(true)
    expect(seen.at(-1)).toBe(false)
  })
})

describe('minecraft updates', () => {
  const versions = ['26.5', '26.4', '26.3', '26.2']

  it('finds the newest version everything supports', async () => {
    const asked: string[] = []
    const u = await findMinecraftUpdate('26.3', versions, async (v) => {
      asked.push(v)
      return v === '26.5' ? ['Lithium has no build for 26.5'] : []
    })
    expect(u).toEqual({
      current: '26.3',
      newest: '26.5',
      ready: '26.4',
      missing: ['Lithium has no build for 26.5'],
    })
    expect(asked).toEqual(['26.5', '26.4'])
  })

  it('says nothing when already on the newest', async () => {
    const u = await findMinecraftUpdate('26.5', versions, async () => {
      throw new Error('not asked')
    })
    expect(u).toEqual({ current: '26.5', newest: null, ready: null, missing: [] })
  })

  it('ignores a version the loader no longer lists', async () => {
    const u = await findMinecraftUpdate('26.3-pre1', versions, async () => [])
    expect(u.newest).toBeNull()
  })

  it('plans at most three versions', async () => {
    const asked: string[] = []
    const u = await findMinecraftUpdate('1', ['6', '5', '4', '3', '2', '1'], async (v) => {
      asked.push(v)
      return ['no']
    })
    expect(asked).toEqual(['6', '5', '4'])
    expect(u.ready).toBeNull()
    expect(u.newest).toBe('6')
  })
})

describe('check schedule', () => {
  it('spreads checks over the first six hours and the hour', () => {
    expect(checkCron(() => 0)).toBe('0 0-23/6 * * *')
    expect(checkCron(() => 0.9999)).toBe('59 5-23/6 * * *')
    for (let i = 0; i < 50; i++) {
      const [m, h] = checkCron().split(' ')
      expect(Number(m)).toBeGreaterThanOrEqual(0)
      expect(Number(m)).toBeLessThan(60)
      expect(Number(h!.split('-')[0])).toBeLessThan(6)
    }
  })
})

describe('java updates', () => {
  it('compares Temurin versions by their numbers', () => {
    expect(compareJava('21.0.6+7', '21.0.5+11.0.LTS')).toBeGreaterThan(0)
    expect(compareJava('21.0.5+11', '21.0.5+11.0.LTS')).toBe(0)
    expect(compareJava('21.0.5+9', '21.0.5+11')).toBeLessThan(0)
    expect(compareJava('25+36', '25.0.1+8')).toBeLessThan(0)
  })

  it('reads installed runtimes from their markers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runtimes-'))
    await mkdir(join(dir, 'temurin-21'))
    await writeFile(
      join(dir, 'temurin-21', '.flytower-runtime.json'),
      JSON.stringify({ vendor: 'temurin', version: '21.0.5+11.0.LTS' }),
    )
    await mkdir(join(dir, 'temurin-25.staging-123'))
    await mkdir(join(dir, 'temurin-17'))
    expect(await installedRuntimes(dir)).toEqual([{ major: 21, version: '21.0.5+11.0.LTS' }])
    expect(await installedRuntimes(join(dir, 'missing'))).toEqual([])
  })

  it("asks Adoptium for this CPU's newest build, JRE first", async () => {
    const urls: string[] = []
    const v = await latestTemurin(21, 'arm64', async (url) => {
      urls.push(url)
      if (url.includes('image_type=jre')) return Response.json([])
      return Response.json([
        { binary: { package: { link: 'https://x/a.zip' } }, version: { semver: '21.0.1' } },
        { binary: { package: { link: 'https://x/b.tar.gz' } }, version: { semver: '21.0.6+7' } },
      ])
    })
    expect(v).toBe('21.0.6+7')
    expect(urls[0]).toContain('/21/hotspot?architecture=aarch64&image_type=jre')
    expect(urls[1]).toContain('image_type=jdk')
  })

  it('fails loudly when Adoptium is down', async () => {
    await expect(
      latestTemurin(21, 'x64', async () => new Response('', { status: 502 })),
    ).rejects.toThrow('Adoptium answered 502')
  })

  it('has nothing for an unknown CPU', async () => {
    expect(await latestTemurin(21, 'riscv64', async () => Response.json([]))).toBeNull()
  })
})
