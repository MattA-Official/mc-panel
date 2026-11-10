import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  modrinthPack,
  type ModrinthPack,
  type PackFile,
  type PackProject,
} from '@flytower/providers'
import { buildPack, packFilename, packKey, packUnavailable } from '../server/status/mrpack'
import { PackStore } from '../server/status/packs'
import type { Lock, LockedItem } from '../server/spec/lock'
import { listZip } from '../server/unzip'

const server = {
  name: 'survival',
  displayName: 'NNT Survival',
  loader: 'fabric',
  mcVersion: '26.3',
  loaderVersion: '0.20.1',
}

const item = (over: Partial<LockedItem>): LockedItem => ({
  source: 'modrinth',
  projectId: 'P',
  slug: 'p',
  title: 'P',
  versionId: 'V',
  versionNumber: '1.0',
  kind: 'mod',
  path: 'mods/p.jar',
  url: 'https://cdn.modrinth.com/p.jar',
  sha256: 'x',
  sha512: 'y',
  size: 1,
  requiredBy: [],
  ...over,
})

const lock: Lock = {
  version: 1,
  updatedAt: '2026-11-10T12:00:00Z',
  content: [
    item({ projectId: 'FAPI', title: 'Fabric API', versionId: 'fapi1' }),
    item({ projectId: 'LITH', title: 'Lithium', versionId: 'lith1' }),
    item({ projectId: 'SPARK', title: 'spark', versionId: 'spark1' }),
    item({ projectId: 'CHUNKY', title: 'Chunky', versionId: 'chunky1' }),
    item({ source: 'url', projectId: 'url:x', title: 'Own jar', versionId: 'u' }),
    item({ projectId: 'DP', title: 'A datapack', versionId: 'dp1', kind: 'datapack' }),
  ],
}

const project = (id: string, over: Partial<PackProject> = {}): PackProject => ({
  id,
  slug: id.toLowerCase(),
  title: id,
  projectType: 'mod',
  clientSide: 'required',
  serverSide: 'required',
  ...over,
})
const file = (projectId: string, versionId: string, deps: string[] = []): PackFile => ({
  projectId,
  versionId,
  versionNumber: `${versionId}-v`,
  filename: `${projectId.toLowerCase()}.jar`,
  url: `https://cdn.modrinth.com/data/${projectId}/${versionId}.jar`,
  size: 10,
  sha1: `sha1-${versionId}`,
  sha512: `sha512-${versionId}`,
  dependencies: deps.map((projectId) => ({ projectId, versionId: null })),
})

function fakeModrinth(): ModrinthPack & { calls: string[] } {
  const projects: Record<string, PackProject> = {
    FAPI: project('FAPI'),
    LITH: project('LITH', { clientSide: 'optional' }),
    SPARK: project('SPARK', { clientSide: 'optional' }),
    CHUNKY: project('CHUNKY', { clientSide: 'unsupported' }),
    IRIS: project('IRIS', { slug: 'iris', title: 'Iris', serverSide: 'unsupported' }),
    SODIUM: project('SODIUM', { slug: 'sodium', title: 'Sodium', serverSide: 'unsupported' }),
    SHADER: project('SHADER', {
      slug: 'complementary',
      title: 'Complementary',
      projectType: 'shader',
    }),
    MODPACK: project('MODPACK', { slug: 'a-modpack', projectType: 'modpack' }),
  }
  const bySlug = (k: string) => projects[k] ?? Object.values(projects).find((p) => p.slug === k)
  const calls: string[] = []
  return {
    calls,
    async projects(ids) {
      calls.push(`projects ${ids.join(',')}`)
      return ids.map(bySlug).filter((p): p is PackProject => !!p)
    },
    async files(ids) {
      calls.push(`files ${ids.join(',')}`)
      const byVersion: Record<string, string> = {
        fapi1: 'FAPI',
        lith1: 'LITH',
        spark1: 'SPARK',
        chunky1: 'CHUNKY',
      }
      return ids.filter((v) => byVersion[v]).map((v) => file(byVersion[v]!, v))
    },
    async latest(id, opts) {
      calls.push(`latest ${id} ${opts.loaders.join('/')} ${opts.minecraft}`)
      if (id === 'IRIS') return file('IRIS', 'iris1', ['SODIUM', 'FAPI'])
      if (id === 'SODIUM') return file('SODIUM', 'sodium1')
      if (id === 'SHADER') return { ...file('SHADER', 'sh1'), filename: 'complementary.zip' }
      return null
    },
  }
}

describe('players modpack', () => {
  test('takes client mods from the server and leaves the rest out', async () => {
    const pack = await buildPack({ server, lock, extras: [], modrinth: fakeModrinth() })
    expect(pack.index.files.map((f) => f.path)).toEqual([
      'mods/fapi.jar',
      'mods/lith.jar',
      'mods/spark.jar',
    ])
    expect(pack.index.files[0]).toEqual({
      path: 'mods/fapi.jar',
      hashes: { sha1: 'sha1-fapi1', sha512: 'sha512-fapi1' },
      env: { client: 'required', server: 'required' },
      downloads: ['https://cdn.modrinth.com/data/FAPI/fapi1.jar'],
      fileSize: 10,
    })
    expect(pack.index.files[1]!.env.client).toBe('optional')
    expect(pack.skipped).toEqual([
      { title: 'Own jar', reason: "Not from Modrinth, so it can't be listed." },
      { title: 'Chunky', reason: 'Only runs on the server.' },
    ])
    expect(pack.index.dependencies).toEqual({ minecraft: '26.3', 'fabric-loader': '0.20.1' })
    expect(pack.index.formatVersion).toBe(1)
    expect(pack.index.name).toBe('NNT Survival')
  })

  test('adds extras with their dependencies, once each', async () => {
    const m = fakeModrinth()
    const pack = await buildPack({
      server,
      lock,
      extras: [{ modrinth: 'iris' }, { modrinth: 'complementary' }, { modrinth: 'nope' }],
      modrinth: m,
    })
    expect(pack.index.files.map((f) => f.path)).toEqual([
      'mods/fapi.jar',
      'mods/lith.jar',
      'mods/spark.jar',
      'mods/iris.jar',
      'shaderpacks/complementary.zip',
      'mods/sodium.jar',
    ])
    expect(pack.index.files.find((f) => f.path === 'mods/iris.jar')!.env).toEqual({
      client: 'required',
      server: 'unsupported',
    })
    expect(pack.included.find((i) => i.kind === 'shader')!.title).toBe('Complementary')
    expect(pack.included.at(-1)!.title).toBe('Sodium (needed by Iris)')
    expect(pack.skipped).toContainEqual({
      title: 'nope',
      reason: 'Modrinth has no project by that name.',
    })
    expect(m.calls).toContain('latest SHADER iris/optifine 26.3')
    expect(m.calls).toContain('latest IRIS fabric 26.3')
  })

  test("refuses project types that can't go in a pack", async () => {
    const pack = await buildPack({
      server,
      lock: { ...lock, content: [] },
      extras: [{ modrinth: 'a-modpack' }],
      modrinth: fakeModrinth(),
    })
    expect(pack.index.files).toEqual([])
    expect(pack.skipped[0]!.reason).toContain('modpack')
  })

  test('is only for Fabric servers', () => {
    expect(packUnavailable({ ...server, loader: 'paper' })).toBe('Modpacks are for Fabric servers.')
    expect(packUnavailable(server)).toBeNull()
  })

  test('the key follows content, extras and versions', () => {
    const k = packKey(server, lock, [])
    expect(packKey(server, lock, [])).toBe(k)
    expect(packKey(server, lock, [{ modrinth: 'iris' }])).not.toBe(k)
    expect(packKey(server, { ...lock, updatedAt: 'later' }, [])).not.toBe(k)
    expect(packKey({ ...server, mcVersion: '26.4' }, lock, [])).not.toBe(k)
  })

  test('file names are safe', () => {
    expect(packFilename('NNT Survival')).toBe('NNT Survival.mrpack')
    expect(packFilename('../"evil"')).toBe('..evil.mrpack')
    expect(packFilename('§§§')).toBe('modpack.mrpack')
  })
})

describe('pack store', () => {
  test('builds once per change, as a zip with the index, and cleans up old ones', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'packs-'))
    let current = lock
    const m = fakeModrinth()
    const store = new PackStore({ dir, modrinth: m, readLock: async () => current })
    const a = await store.get(server, [])
    const again = await store.get(server, [])
    expect(again).toBe(a)
    expect(m.calls.filter((c) => c.startsWith('files')).length).toBe(1)
    const entries = await listZip(a.path!)
    expect(entries.map((e) => e.name)).toEqual(['modrinth.index.json'])
    current = { ...lock, updatedAt: 'later' }
    const b = await store.get(server, [])
    expect(b.path).not.toBe(a.path)
    expect(readdirSync(dir)).toEqual([b.path!.split('/').at(-1)!])
    expect(store.peek(server, current, [])).toBe(b)
    expect(store.peek(server, lock, [])).toBeUndefined()
  })

  test('nothing for players means no file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'packs-'))
    const store = new PackStore({
      dir,
      modrinth: fakeModrinth(),
      readLock: async () => ({ ...lock, content: [lock.content[3]!] }),
    })
    const pack = await store.get(server, [])
    expect(pack.path).toBeNull()
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('modrinth pack lookups', () => {
  const version = (over: Record<string, unknown> = {}) => ({
    id: 'v1',
    project_id: 'P1',
    version_number: '1.0',
    version_type: 'release',
    loaders: ['fabric'],
    game_versions: ['26.3'],
    date_published: '2026-01-01',
    files: [
      {
        url: 'https://cdn.modrinth.com/data/P1/v1/p.jar',
        filename: 'p.jar',
        primary: true,
        size: 5,
        hashes: { sha1: 'a', sha512: 'b' },
      },
    ],
    dependencies: [{ project_id: 'DEP', version_id: null, dependency_type: 'required' }],
    ...over,
  })

  test('reads both hashes and only trusts Modrinth downloads', async () => {
    const urls: string[] = []
    const api = modrinthPack(async (url) => {
      urls.push(String(url))
      return Response.json([
        version(),
        version({
          id: 'v2',
          files: [
            {
              url: 'https://evil.example/p.jar',
              filename: 'p.jar',
              primary: true,
              size: 1,
              hashes: { sha1: 'a', sha512: 'b' },
            },
          ],
        }),
        version({ id: 'v3', files: [{ ...version().files[0], hashes: { sha512: 'b' } }] }),
      ])
    }, 'https://api.test')
    const files = await api.files(['v1', 'v2', 'v3'])
    expect(files).toEqual([
      {
        projectId: 'P1',
        versionId: 'v1',
        versionNumber: '1.0',
        filename: 'p.jar',
        url: 'https://cdn.modrinth.com/data/P1/v1/p.jar',
        size: 5,
        sha1: 'a',
        sha512: 'b',
        dependencies: [{ projectId: 'DEP', versionId: null }],
      },
    ])
    expect(decodeURIComponent(urls[0]!)).toBe('https://api.test/versions?ids=["v1","v2","v3"]')
  })

  test('latest picks the newest release for the version and loaders', async () => {
    let asked = ''
    const api = modrinthPack(async (url) => {
      asked = decodeURIComponent(String(url))
      return Response.json([
        version({ id: 'old', version_number: '0.9', date_published: '2025-01-01' }),
        version({ id: 'beta', version_type: 'beta', date_published: '2026-06-01' }),
        version(),
      ])
    }, 'https://api.test')
    const f = await api.latest('iris', { loaders: ['fabric'], minecraft: '26.3' })
    expect(f?.versionId).toBe('v1')
    expect(asked).toContain('/project/iris/version?loaders=["fabric"]&game_versions=["26.3"]')
    expect(
      (await api.latest('iris', { loaders: ['fabric'], minecraft: '26.3', version: '0.9' }))
        ?.versionId,
    ).toBe('old')
    expect(await api.latest('../x', { loaders: ['fabric'], minecraft: '26.3' })).toBeNull()
  })
})
