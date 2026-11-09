import { describe, expect, test } from 'bun:test'
import {
  modrinthProvider,
  parseCategories,
  requestDownload,
  resolveAll,
  vanillaTweaksProvider,
  vtVersions,
  type Fetch,
} from '../src/index.ts'

const DP = {
  categories: [
    {
      category: 'Survival',
      packs: [
        {
          name: 'multiplayer sleep',
          display: 'Multiplayer Sleep',
          version: '2.9.0',
          description: 'Only <b>some</b> players need to sleep.',
          incompatible: ['afk display'],
        },
        { name: 'afk display', display: 'AFK Display', version: '1.1.18', description: '' },
      ],
      categories: [
        {
          category: 'Graves',
          packs: [
            { name: 'graves', display: 'Graves', version: '3.0.0', description: 'Keep items' },
          ],
        },
      ],
    },
    { category: 'Empty', packs: [] },
  ],
}
const CT = {
  categories: [
    {
      category: 'Quality of Life',
      packs: [{ name: 'craftable gravel', display: 'Craftable Gravel', version: '1.0.0' }],
    },
  ],
}

function fakeSite(calls: string[] = [], opts: { versions?: string[] } = {}): Fetch {
  const versions = opts.versions ?? ['26.3']
  return async (input, init) => {
    const url = new URL(String(input))
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`)
    const m = /^\/assets\/resources\/json\/([^/]+)\/(dp|ct)categories\.json$/.exec(url.pathname)
    if (m) {
      if (!versions.includes(m[1]!)) return new Response('', { status: 404 })
      return Response.json(m[2] === 'dp' ? DP : CT)
    }
    if (url.pathname === '/assets/server/zipdatapacks.php') {
      const form = new URLSearchParams(String(init?.body))
      calls.push(`form ${form.get('packs')} ${form.get('version')}`)
      return Response.json({ status: 'success', link: '/download/VanillaTweaks_d1_UNZIP_ME.zip' })
    }
    return new Response('', { status: 404 })
  }
}

describe('vanilla tweaks', () => {
  test('flattens nested categories and strips markup', () => {
    const cats = parseCategories(DP)
    expect(cats.map((c) => c.name)).toEqual(['Survival', 'Survival/Graves'])
    expect(cats[0]!.packs[0]!.description).toBe('Only some players need to sleep.')
    expect(() => parseCategories({ nope: 1 })).toThrow('upload it in Files')
  })

  test('falls back from 1.21.4 to 1.21', async () => {
    expect(vtVersions('1.21.4')).toEqual(['1.21.4', '1.21'])
    expect(vtVersions('26.3')).toEqual(['26.3'])
    const calls: string[] = []
    const vt = vanillaTweaksProvider(fakeSite(calls, { versions: ['1.21'] }), 'https://vt.test')
    expect((await vt.catalogue('1.21.4')).version).toBe('1.21')
    await expect(
      vanillaTweaksProvider(fakeSite(), 'https://vt.test').catalogue('1.8'),
    ).rejects.toThrow('no packs for Minecraft 1.8')
  })

  test('resolves a pack to a builder request, wrapped, with its catalogue version', async () => {
    const vt = vanillaTweaksProvider(fakeSite(), 'https://vt.test')
    const r = await vt.resolve({ pack: 'survival/Multiplayer Sleep' }, '26.3')
    expect(r).toMatchObject({
      source: 'vanillatweaks',
      projectId: 'datapack:Survival/multiplayer sleep',
      title: 'Multiplayer Sleep',
      versionId: '2.9.0',
      filename: 'vt-multiplayer-sleep.zip',
      hash: null,
      wrapped: true,
      incompatible: ['datapack:Survival/afk display'],
      request: {
        url: 'https://vt.test/assets/server/zipdatapacks.php',
        form: { packs: '{"survival":["multiplayer sleep"]}', version: '26.3' },
      },
    })
    const nested = await vt.resolve({ pack: 'Survival/Graves/graves' }, '26.3')
    expect(nested.request!.form.packs).toBe('{"survival":["graves"]}')
    const ct = await vt.resolve(
      { pack: 'Quality of Life/craftable gravel', tweak: 'crafting' },
      '26.3',
    )
    expect(ct).toMatchObject({ filename: 'vt-ct-craftable-gravel.zip', wrapped: false })
    await expect(vt.resolve({ pack: 'Survival/nope' }, '26.3')).rejects.toThrow('no datapack')
  })

  test('the builder link must stay on the same site', async () => {
    const calls: string[] = []
    const link = await requestDownload(fakeSite(calls), {
      url: 'https://vt.test/assets/server/zipdatapacks.php',
      form: { packs: '{"survival":["graves"]}', version: '26.3' },
    })
    expect(link).toBe('https://vt.test/download/VanillaTweaks_d1_UNZIP_ME.zip')
    expect(calls).toContain('form {"survival":["graves"]} 26.3')
    const evil: Fetch = async () =>
      Response.json({ status: 'success', link: 'https://evil.test/x.zip' })
    await expect(
      requestDownload(evil, { url: 'https://vt.test/a.php', form: {} }),
    ).rejects.toThrow()
    const broken: Fetch = async () => Response.json({ status: 'error' })
    await expect(
      requestDownload(broken, { url: 'https://vt.test/a.php', form: {} }),
    ).rejects.toThrow('upload it in Files')
  })

  test('resolveAll takes Vanilla Tweaks packs, keeps pinned versions and flags clashes', async () => {
    const vt = vanillaTweaksProvider(fakeSite(), 'https://vt.test')
    const set = await resolveAll(
      [{ vanillatweaks: 'Survival/multiplayer sleep' }, { vanillatweaks: 'Survival/afk display' }],
      { loader: 'vanilla', minecraft: '26.3' },
      modrinthProvider(async () => new Response('', { status: 404 })),
      {
        vanillatweaks: vt,
        pinned: (p) => (p === 'datapack:Survival/afk display' ? '1.0.0' : undefined),
      },
    )
    expect(set.items.map((i) => i.versionId)).toEqual(['2.9.0', '1.0.0'])
    expect(set.problems).toEqual(["Multiplayer Sleep can't run alongside AFK Display."])
  })
})
