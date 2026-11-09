import { describe, expect, test } from 'bun:test'
import {
  hangarProvider,
  ProviderError,
  resolveAll,
  modrinthProvider,
  type Fetch,
} from '../src/index.ts'

const paper = { loader: 'paper' as const, minecraft: '26.3' }
const SHA = 'c'.repeat(64)

const project = (slug: string, owner = 'someone') => ({
  id: slug.length,
  name: slug[0]!.toUpperCase() + slug.slice(1),
  namespace: { owner, slug },
  description: `${slug} plugin`,
  avatarUrl: '',
  stats: { downloads: 100 },
})
const version = (name: string, extra: object = {}) => ({
  id: 1,
  name,
  createdAt: '2026-10-01T00:00:00Z',
  channel: { name: 'Release' },
  downloads: {
    PAPER: {
      fileInfo: { name: `Plugin-${name}.jar`, sizeBytes: 10, sha256Hash: SHA },
      externalUrl: null,
      downloadUrl: `https://hangar.papermc.io/api/v1/projects/x/versions/${name}/PAPER/download`,
    },
  },
  pluginDependencies: { PAPER: [] },
  platformDependencies: { PAPER: ['26.2', '26.3'] },
  ...extra,
})

const projects: Record<string, object> = {
  worldedit: project('worldedit'),
  griefprevention: project('griefprevention'),
  external: project('external'),
}
const versions: Record<string, object[]> = {
  worldedit: [
    version('7.4.0-beta', { channel: { name: 'Beta' }, createdAt: '2026-11-01T00:00:00Z' }),
    version('7.3.9'),
    version('7.2.0', { platformDependencies: { PAPER: ['26.1'] } }),
  ],
  griefprevention: [
    version('16.18', {
      pluginDependencies: {
        PAPER: [
          { name: 'worldedit', required: true, externalUrl: null },
          { name: 'Vault', required: true, externalUrl: 'https://example.com/vault' },
          { name: 'dynmap', required: false, externalUrl: null },
        ],
      },
    }),
  ],
  external: [
    version('1.0', {
      downloads: {
        PAPER: { fileInfo: null, externalUrl: 'https://example.com/x.jar', downloadUrl: null },
      },
    }),
  ],
}

function fakeHangar(calls: string[] = []): Fetch {
  return async (input) => {
    const url = new URL(String(input))
    calls.push(url.pathname + url.search)
    const json = (v: unknown) => new Response(JSON.stringify(v))
    let m = /^\/api\/v1\/projects\/([^/]+)$/.exec(url.pathname)
    if (m) return projects[m[1]!] ? json(projects[m[1]!]) : new Response('', { status: 404 })
    m = /^\/api\/v1\/projects\/([^/]+)\/versions$/.exec(url.pathname)
    if (m) return json({ pagination: { count: 1 }, result: versions[m[1]!] ?? [] })
    m = /^\/api\/v1\/projects\/([^/]+)\/versions\/([^/]+)$/.exec(url.pathname)
    if (m) {
      const v = (versions[m[1]!] ?? []).find((x) => (x as { name: string }).name === m![2])
      return v ? json(v) : new Response('', { status: 404 })
    }
    if (url.pathname === '/api/v1/projects') {
      return json({
        pagination: { count: 2 },
        result: [projects.worldedit, projects.griefprevention],
      })
    }
    return new Response('', { status: 404 })
  }
}

describe('hangar', () => {
  test('search asks for Paper plugins for this Minecraft version', async () => {
    const calls: string[] = []
    const h = hangarProvider(fakeHangar(calls))
    const r = await h.search('world', { kind: 'plugin', target: paper })
    expect(r.total).toBe(2)
    expect(r.hits[0]).toMatchObject({ source: 'hangar', slug: 'worldedit', kind: 'plugin' })
    expect(calls[0]).toContain('platform=PAPER')
    expect(calls[0]).toContain('version=26.3')
  })

  test('resolves the newest release for this version, with its sha256', async () => {
    const h = hangarProvider(fakeHangar())
    const r = await h.resolve({ project: 'someone/worldedit' }, paper)
    expect(r).toMatchObject({
      source: 'hangar',
      projectId: 'hangar:worldedit',
      versionId: '7.3.9',
      kind: 'plugin',
      filename: 'Plugin-7.3.9.jar',
      hash: { algorithm: 'sha256', value: SHA },
    })
    expect(
      (await h.resolve({ project: 'worldedit', version: '7.4.0-beta' }, paper)).versionId,
    ).toBe('7.4.0-beta')
    await expect(h.resolve({ project: 'worldedit', version: '7.2.0' }, paper)).rejects.toThrow(
      "isn't made for Paper on Minecraft 26.3",
    )
  })

  test('refuses downloads it cannot check, and unknown projects', async () => {
    const h = hangarProvider(fakeHangar())
    await expect(h.resolve({ project: 'external' }, paper)).rejects.toThrow('hosted outside Hangar')
    await expect(h.resolve({ project: 'nope' }, paper)).rejects.toThrow(ProviderError)
  })

  test('required Hangar dependencies come along; outside ones are left', async () => {
    const set = await resolveAll(
      [{ hangar: 'griefprevention' }],
      paper,
      modrinthProvider(fakeHangar()),
      {
        hangar: hangarProvider(fakeHangar()),
      },
    )
    expect(set.problems).toEqual([])
    expect(set.items.map((i) => [i.slug, i.requiredBy])).toEqual([
      ['griefprevention', []],
      ['worldedit', ['Griefprevention']],
    ])
  })
})
