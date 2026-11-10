import { describe, expect, test } from 'bun:test'
import { Roster, SEED_RETRY_MS } from '../server/status/roster'
import { publicStatus, type PageInput } from '../server/status/page'
import { previewTags } from '../server/status/preview'
import {
  PublicPage,
  compactPublicPage,
  defaultPublicPage,
  describePublicPage,
} from '../shared/public-page'
import { compactSpec } from '../shared/spec'
import { specFromServer } from '../server/spec/from-server'
import { parseSpec, toYaml } from '../server/spec/yaml'

const online = (names: string[], max = 20) => ({ count: names.length, max, names })

describe('roster', () => {
  test('asks the console once, then follows the log', async () => {
    let asked = 0
    const r = new Roster(async () => {
      asked++
      return online(['Alex'])
    })
    expect(await r.view('s', true)).toEqual({ ready: true, players: ['Alex'], max: 20 })
    r.observe('s', { kind: 'joined', player: 'Steve' })
    r.observe('s', { kind: 'left', player: 'Alex' })
    expect((await r.view('s', true)).players).toEqual(['Steve'])
    expect(asked).toBe(1)
  })

  test('a fresh start empties it without asking', async () => {
    let asked = 0
    const r = new Roster(async () => {
      asked++
      return online([])
    })
    r.observe('s', { kind: 'joined', player: 'Steve' })
    r.observe('s', { kind: 'ready' })
    r.observe('s', { kind: 'joined', player: 'Alex' })
    expect(await r.view('s', true)).toMatchObject({ ready: true, players: ['Alex'] })
    expect(asked).toBe(0)
  })

  test('stopping clears it, and the next look asks again', async () => {
    let asked = 0
    const r = new Roster(async () => {
      asked++
      return online(['Alex'])
    })
    await r.view('s', true)
    r.observe('s', { kind: 'stopping' })
    expect(await r.view('s', false)).toMatchObject({ ready: false, players: [] })
    await r.view('s', true)
    expect(asked).toBe(2)
  })

  test("a console that doesn't answer is left alone for a minute", async () => {
    let now = 0
    let asked = 0
    const r = new Roster(
      async () => {
        asked++
        return null
      },
      () => now,
    )
    expect(await r.view('s', true)).toEqual({ ready: false, players: null, max: null })
    await r.view('s', true)
    expect(asked).toBe(1)
    now += SEED_RETRY_MS
    await r.view('s', true)
    expect(asked).toBe(2)
  })

  test('visitors arriving together share one question', async () => {
    let asked = 0
    const r = new Roster(async () => {
      asked++
      await Bun.sleep(5)
      return online(['Alex'])
    })
    await Promise.all([r.view('s', true), r.view('s', true), r.view('s', true)])
    expect(asked).toBe(1)
  })
})

const base = (over: Partial<PageInput> = {}): PageInput => ({
  row: {
    name: 'survival',
    displayName: 'Survival',
    loader: 'fabric',
    mcVersion: '26.3',
    hostname: null,
    port: 25566,
  },
  page: PublicPage.parse({ enabled: true, description: 'Hi' }),
  service: 'active',
  roster: { ready: true, players: ['Alex', 'Steve'], max: 20 },
  machine: 'panel.example.com',
  motd: '§6Hello',
  maxPlayers: 30,
  withUuids: (names) => names.map((name) => ({ name, uuid: `uuid-${name}` })),
  ...over,
})

describe('public status', () => {
  test('counts players by default, without names', () => {
    const s = publicStatus(base())
    expect(s.state).toBe('online')
    expect(s.players).toEqual({ count: 2, max: 30 })
    expect(s.address).toBe('panel.example.com:25566')
    expect(s.version).toEqual({ minecraft: '26.3', loader: 'Fabric' })
    expect(s.motd).toBe('§6Hello')
  })

  test('names only when the page says so', () => {
    const page = PublicPage.parse({ enabled: true, show: { players: 'names' } })
    expect(publicStatus(base({ page })).players?.list).toEqual([
      { name: 'Alex', uuid: 'uuid-Alex' },
      { name: 'Steve', uuid: 'uuid-Steve' },
    ])
  })

  test('nothing about players or the version when hidden', () => {
    const page = PublicPage.parse({ enabled: true, show: { players: 'none', version: false } })
    const s = publicStatus(base({ page }))
    expect(s.players).toBeNull()
    expect(s.version).toBeNull()
  })

  test('sends nothing the page does not show', () => {
    const keys = Object.keys(publicStatus(base())).sort()
    expect(keys).toEqual(
      [
        'address',
        'description',
        'displayName',
        'motd',
        'name',
        'players',
        'state',
        'version',
      ].sort(),
    )
  })

  test('starting and offline, with nobody on', () => {
    expect(publicStatus(base({ roster: { ready: false, players: null, max: null } })).state).toBe(
      'starting',
    )
    expect(publicStatus(base({ service: 'activating' })).state).toBe('starting')
    const off = publicStatus(base({ service: 'failed' }))
    expect(off.state).toBe('offline')
    expect(off.players).toEqual({ count: 0, max: 30 })
  })

  test('uses the hostname, and leaves out the default port', () => {
    const row = { ...base().row, hostname: 'survival.example.com' }
    expect(publicStatus(base({ row })).address).toBe('survival.example.com')
    expect(publicStatus(base({ row: { ...base().row, port: 25565 } })).address).toBe(
      'panel.example.com',
    )
  })
})

describe('public page settings', () => {
  test('defaults are off and count only', () => {
    expect(defaultPublicPage()).toEqual({
      enabled: false,
      description: '',
      show: { players: 'count', version: true },
    })
    expect(compactPublicPage(defaultPublicPage())).toBeNull()
    expect(describePublicPage(defaultPublicPage())).toBe('Off')
  })

  test('round-trips through a spec, leaving defaults out', () => {
    const row = {
      name: 'survival',
      displayName: 'Survival',
      loader: 'fabric' as const,
      mcVersion: '26.3',
      loaderVersion: '0.20.1',
      javaMajor: 25,
      memoryMb: 4096,
      port: 25565,
      backupSchedule: null,
      backupTz: 'UTC',
      keepLast: 6,
      keepDaily: 7,
      keepWeekly: 4,
      content: [],
      timezone: 'UTC',
      publicPage: PublicPage.parse({
        enabled: true,
        description: 'Two\nlines',
        show: { players: 'names' },
      }),
    }
    const spec = specFromServer(row as never, {})
    const yaml = toYaml(spec)
    expect(yaml).toContain('public:')
    expect(yaml).toContain('players: names')
    expect(yaml).not.toContain('version: true')
    const back = parseSpec(yaml)
    expect(back.ok && back.spec.public).toEqual(row.publicPage)
    expect(compactSpec(spec).public).toEqual({
      enabled: true,
      description: 'Two\nlines',
      show: { players: 'names' },
    })
  })

  test('rejects unknown keys and long descriptions', () => {
    expect(PublicPage.safeParse({ enabled: true, colour: 'red' }).success).toBe(false)
    expect(PublicPage.safeParse({ description: 'x'.repeat(501) }).success).toBe(false)
    expect(PublicPage.safeParse({ show: { players: 'all' } }).success).toBe(false)
  })
})

describe('link previews', () => {
  test('escapes what people wrote', () => {
    const tags = previewTags({
      displayName: 'A <b>"server"</b>',
      description: "It's\n  great & <fun>",
      site: 'NNT',
      image: null,
    })
    expect(tags.join('')).toContain('content="A &lt;b&gt;&quot;server&quot;&lt;/b&gt;"')
    expect(tags.join('')).toContain('content="It&#39;s great &amp; &lt;fun&gt;"')
    expect(tags.join('')).not.toContain('og:image')
  })

  test('a server with no description still gets one', () => {
    const tags = previewTags({
      displayName: 'Survival',
      description: '',
      site: 'NNT',
      image: 'https://x/logo',
    })
    expect(tags.join('')).toContain('Join Survival, a Minecraft server.')
    expect(tags.join('')).toContain('og:image" content="https://x/logo"')
  })
})
