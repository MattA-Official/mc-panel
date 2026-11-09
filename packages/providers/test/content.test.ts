import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  downloadVerified,
  modrinthProvider,
  ProviderError,
  resolveAll,
  resolveUrl,
  type Fetch,
} from '../src/index.ts'

const target = { loader: 'fabric' as const, minecraft: '26.3' }
const FILE = 'mod bytes'
const SHA512 = new Bun.CryptoHasher('sha512').update(FILE).digest('hex')

const project = (id: string, slug: string, extra: object = {}) => ({
  id,
  slug,
  title: slug[0]!.toUpperCase() + slug.slice(1),
  project_type: 'mod',
  server_side: 'optional',
  loaders: ['fabric'],
  ...extra,
})

const version = (id: string, projectId: string, extra: object = {}) => ({
  id,
  project_id: projectId,
  version_number: `${id}-1.0`,
  version_type: 'release',
  loaders: ['fabric'],
  game_versions: ['26.3'],
  date_published: '2026-10-01T00:00:00Z',
  files: [
    {
      url: `https://cdn.modrinth.com/data/${projectId}/${id}.jar`,
      filename: `${id}.jar`,
      primary: true,
      size: 9,
      hashes: { sha512: SHA512, sha1: 'x' },
    },
  ],
  dependencies: [],
  ...extra,
})

const projects: Record<string, object> = {
  lithium: project('P_lith', 'lithium'),
  P_lith: project('P_lith', 'lithium'),
  'fabric-api': project('P_fapi', 'fabric-api'),
  P_fapi: project('P_fapi', 'fabric-api'),
  chunky: project('P_chnk', 'chunky'),
  P_chnk: project('P_chnk', 'chunky'),
  P_loop: project('P_loop', 'loop'),
  zoom: project('P_zoom', 'zoom', { server_side: 'unsupported' }),
  terralith: project('P_terr', 'terralith', { loaders: ['fabric', 'datapack'] }),
  P_terr: project('P_terr', 'terralith', { loaders: ['fabric', 'datapack'] }),
  sodiumish: project('P_sodi', 'sodiumish'),
  P_sodi: project('P_sodi', 'sodiumish'),
}

const versions: Record<string, object[]> = {
  P_lith: [
    version('LithBeta', 'P_lith', { version_type: 'beta', date_published: '2026-11-01T00:00:00Z' }),
    version('LithRel1', 'P_lith'),
    version('LithOld1', 'P_lith', { date_published: '2026-01-01T00:00:00Z' }),
  ],
  P_chnk: [
    version('Chunky01', 'P_chnk', {
      dependencies: [{ project_id: 'P_fapi', version_id: null, dependency_type: 'required' }],
    }),
  ],
  P_fapi: [
    version('FapiVer1', 'P_fapi', {
      dependencies: [{ project_id: 'P_loop', version_id: null, dependency_type: 'required' }],
    }),
  ],
  P_loop: [
    version('LoopVer1', 'P_loop', {
      dependencies: [{ project_id: 'P_fapi', version_id: null, dependency_type: 'required' }],
    }),
  ],
  P_terr: [version('TerrDp01', 'P_terr', { loaders: ['datapack'] })],
  P_sodi: [
    version('SodiVer1', 'P_sodi', {
      dependencies: [{ project_id: 'P_lith', version_id: null, dependency_type: 'incompatible' }],
    }),
  ],
}

function fakeModrinth(calls: string[] = []): Fetch {
  return async (input) => {
    const url = new URL(String(input))
    calls.push(url.pathname + url.search)
    const json = (v: unknown) => new Response(JSON.stringify(v))
    let m = /^\/v2\/project\/([^/]+)$/.exec(url.pathname)
    if (m) return projects[m[1]!] ? json(projects[m[1]!]) : new Response('', { status: 404 })
    m = /^\/v2\/project\/([^/]+)\/version$/.exec(url.pathname)
    if (m) {
      const loaders = JSON.parse(url.searchParams.get('loaders') ?? 'null') as string[] | null
      const games = JSON.parse(url.searchParams.get('game_versions') ?? 'null') as string[] | null
      const list = (versions[m[1]!] ?? []) as { loaders: string[]; game_versions: string[] }[]
      return json(
        list.filter(
          (v) =>
            (!loaders || v.loaders.some((l) => loaders.includes(l))) &&
            (!games || v.game_versions.some((g) => games.includes(g))),
        ),
      )
    }
    m = /^\/v2\/version\/([^/]+)$/.exec(url.pathname)
    if (m) {
      const v = Object.values(versions)
        .flat()
        .find((x) => (x as { id: string }).id === m![1])
      return v ? json(v) : new Response('', { status: 404 })
    }
    if (url.pathname === '/v2/search') {
      return json({
        total_hits: 2,
        hits: [
          {
            project_id: 'P_lith',
            slug: 'lithium',
            title: 'Lithium',
            description: 'Fast',
            author: 'jelly',
            icon_url: '',
            downloads: 10,
            project_type: 'mod',
            server_side: 'optional',
          },
          {
            project_id: 'P_zoom',
            slug: 'zoom',
            title: 'Zoom',
            description: 'Client',
            author: 'x',
            icon_url: null,
            downloads: 5,
            project_type: 'mod',
            server_side: 'unsupported',
          },
        ],
      })
    }
    if (url.hostname === 'cdn.modrinth.com') return new Response(FILE)
    return new Response('', { status: 404 })
  }
}

describe('modrinth', () => {
  test('search filters by loader and version, and drops client-only mods', async () => {
    const calls: string[] = []
    const m = modrinthProvider(fakeModrinth(calls))
    const { hits } = await m.search('lith', { kind: 'mod', target })
    expect(hits.map((h) => h.slug)).toEqual(['lithium'])
    expect(hits[0]!.iconUrl).toBeNull()
    const facets = JSON.parse(new URLSearchParams(calls[0]!.split('?')[1]).get('facets')!)
    expect(facets).toContainEqual(['versions:26.3'])
    expect(facets).toContainEqual(['categories:fabric'])
  })

  test('picks the newest release over a newer beta', async () => {
    const r = await modrinthProvider(fakeModrinth()).resolve({ project: 'lithium' }, target)
    expect(r.versionId).toBe('LithRel1')
    expect(r.hash).toEqual({ algorithm: 'sha512', value: SHA512 })
    expect(r.kind).toBe('mod')
  })

  test('an exact version by number or id', async () => {
    const m = modrinthProvider(fakeModrinth())
    expect(
      (await m.resolve({ project: 'lithium', version: 'LithOld1-1.0' }, target)).versionId,
    ).toBe('LithOld1')
    expect((await m.resolve({ project: 'lithium', version: 'LithBeta' }, target)).versionId).toBe(
      'LithBeta',
    )
    await expect(m.resolve({ project: 'lithium', version: 'nope' }, target)).rejects.toThrow(
      'no version',
    )
  })

  test('refuses client-only mods and unknown projects', async () => {
    const m = modrinthProvider(fakeModrinth())
    await expect(m.resolve({ project: 'zoom' }, target)).rejects.toThrow("players' computers")
    await expect(m.resolve({ project: 'ghost' }, target)).rejects.toThrow('no project')
    await expect(m.resolve({ project: '../etc' }, target)).rejects.toThrow(ProviderError)
  })

  test('datapacks use the datapack loader', async () => {
    const m = modrinthProvider(fakeModrinth())
    const r = await m.resolve({ project: 'terralith', kind: 'datapack' }, target)
    expect(r.kind).toBe('datapack')
    const v = await m.resolve(
      { project: 'terralith', kind: 'datapack' },
      { loader: 'vanilla', minecraft: '26.3' },
    )
    expect(v.versionId).toBe('TerrDp01')
  })

  test('no compatible version is a clear error', async () => {
    const m = modrinthProvider(fakeModrinth())
    await expect(
      m.resolve({ project: 'lithium' }, { loader: 'fabric', minecraft: '1.8' }),
    ).rejects.toThrow('no version for fabric on Minecraft 1.8')
  })
})

describe('resolveAll', () => {
  test('pulls in required dependencies, surviving a cycle', async () => {
    const set = await resolveAll(
      [{ modrinth: 'chunky' }, { modrinth: 'lithium' }],
      target,
      modrinthProvider(fakeModrinth()),
    )
    expect(set.problems).toEqual([])
    expect(set.items.map((i) => i.slug)).toEqual(['chunky', 'lithium', 'fabric-api', 'loop'])
    expect(set.items.find((i) => i.slug === 'fabric-api')!.requiredBy).toEqual(['Chunky', 'Loop'])
  })

  test('reports incompatibilities, duplicates and failures without throwing', async () => {
    const set = await resolveAll(
      [
        { modrinth: 'lithium' },
        { modrinth: 'sodiumish' },
        { modrinth: 'P_lith' },
        { modrinth: 'ghost' },
      ],
      target,
      modrinthProvider(fakeModrinth()),
    )
    expect(set.problems).toContain("Sodiumish can't run alongside Lithium.")
    expect(set.problems).toContain('Lithium is listed twice.')
    expect(set.problems.some((p) => p.includes('ghost'))).toBe(true)
  })

  test('a pinned version wins over a dependency', async () => {
    const set = await resolveAll(
      [{ modrinth: 'fabric-api' }, { modrinth: 'chunky' }],
      target,
      modrinthProvider(fakeModrinth()),
    )
    expect(set.items.filter((i) => i.slug === 'fabric-api')).toHaveLength(1)
  })
})

describe('url content', () => {
  const sha = 'a'.repeat(64)
  test('needs https, a hash and a fitting file name', () => {
    expect(
      resolveUrl({ url: 'https://x.test/a/my-mod.jar', sha256: sha, kind: 'mod' }).filename,
    ).toBe('my-mod.jar')
    expect(() => resolveUrl({ url: 'http://x.test/a.jar', sha256: sha, kind: 'mod' })).toThrow(
      'https',
    )
    expect(() => resolveUrl({ url: 'https://x.test/a.jar', sha256: 'abc', kind: 'mod' })).toThrow(
      'SHA-256',
    )
    expect(() => resolveUrl({ url: 'https://x.test/pack', sha256: sha, kind: 'datapack' })).toThrow(
      '.zip',
    )
    expect(
      resolveUrl({
        url: 'https://x.test/dl?id=1',
        sha256: sha,
        kind: 'datapack',
        filename: 'p.zip',
      }).filename,
    ).toBe('p.zip')
  })
})

describe('sha512 downloads', () => {
  test('checks the published hash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ft-dl-'))
    const f = fakeModrinth()
    const ok = await downloadVerified(f, 'https://cdn.modrinth.com/x.jar', join(dir, 'a.jar'), {
      algorithm: 'sha512',
      value: SHA512,
    })
    expect(ok.bytes).toBe(9)
    expect(
      downloadVerified(f, 'https://cdn.modrinth.com/x.jar', join(dir, 'b.jar'), {
        algorithm: 'sha512',
        value: 'f'.repeat(128),
      }),
    ).rejects.toThrow('checksum')
  })
})

describe('pinned versions', () => {
  test('locked versions are kept for unpinned items and dependencies', async () => {
    const pins: Record<string, string> = { lithium: 'LithOld1', P_fapi: 'FapiVer1' }
    const set = await resolveAll(
      [{ modrinth: 'lithium' }, { modrinth: 'chunky' }],
      target,
      modrinthProvider(fakeModrinth()),
      { pinned: (p) => pins[p] },
    )
    expect(set.items.find((i) => i.slug === 'lithium')!.versionId).toBe('LithOld1')
    expect(set.items.find((i) => i.slug === 'fabric-api')!.versionId).toBe('FapiVer1')
  })
})
