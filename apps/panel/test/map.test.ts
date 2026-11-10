import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import type { Verb } from '@flytower/protocol'
import {
  compactMap,
  describeMap,
  MapSettings,
  readMapSettings,
  sameMapSettings,
} from '../shared/map-settings'
import { isExcluded } from '../server/backups/archive'
import { openDb, schema } from '../server/db'
import type { AgentCall } from '../server/jobs/runner'
import { MAP_CSP, mapAccess, mapFile } from '../server/map/serve'
import { MapService, plainReply } from '../server/map/service'
import { dataDir, hasSquaremap, squaremapConfig, webDir } from '../server/map/squaremap'
import { writeLock } from '../server/spec/lock'

describe('map settings', () => {
  it('is private with players until set', () => {
    expect(readMapSettings(null)).toEqual({ public: false, players: true })
    expect(readMapSettings({ public: 'yes' })).toEqual({ public: false, players: true })
    expect(MapSettings.safeParse({ public: true, extra: 1 }).success).toBe(false)
  })

  it('compares, describes and compacts', () => {
    const open = { public: true, players: false }
    expect(sameMapSettings(open, { ...open })).toBe(true)
    expect(sameMapSettings(open, { ...open, players: true })).toBe(false)
    expect(describeMap(open)).toBe('Anyone, no players')
    expect(describeMap(readMapSettings(null))).toBe('Signed-in people, with players')
    expect(compactMap(readMapSettings(null))).toBeNull()
    expect(compactMap(open)).toEqual({ public: true, players: false })
  })
})

describe('squaremap', () => {
  it('lives in a folder that depends on the loader', () => {
    expect(dataDir('fabric')).toBe('squaremap')
    expect(dataDir('paper')).toBe('plugins/squaremap')
    expect(dataDir('vanilla')).toBeNull()
    expect(webDir('paper')).toBe('plugins/squaremap/web')
  })

  it('is found in the lock from Modrinth or Hangar', () => {
    const item = (source: string, slug: string, kind = 'mod') => ({ source, slug, kind }) as never
    expect(hasSquaremap([item('modrinth', 'squaremap')])).toBe(true)
    expect(hasSquaremap([item('hangar', 'squaremap', 'plugin')])).toBe(true)
    expect(hasSquaremap([item('url', 'squaremap')])).toBe(false)
    expect(hasSquaremap([item('modrinth', 'chunky')])).toBe(false)
  })

  it('writes a config with its web server off before squaremap makes one', () => {
    const text = squaremapConfig(null, { map: readMapSettings(null), cores: 4 })!
    const yaml = Bun.YAML.parse(text) as never as Record<string, Record<string, unknown>>
    expect(yaml.settings).toEqual({ 'internal-webserver': { enabled: false } })
    expect(yaml['world-settings']).toEqual({
      default: {
        'player-tracker': { enabled: true, nameplate: { 'show-head': false } },
        map: { render: { background: { workers: 1 } } },
      },
    })
  })

  it('keeps everything else, and leaves a chosen worker count alone', () => {
    const existing = Bun.YAML.stringify({
      'config-version': 3,
      settings: { 'internal-webserver': { enabled: true, port: 8080 }, 'web-address': 'x' },
      'world-settings': {
        default: { map: { render: { background: { workers: 3 } } } },
        'minecraft:the_end': { map: { enabled: false } },
      },
    })
    const text = squaremapConfig(existing, {
      map: { public: false, players: false },
      cores: 2,
    })!
    const yaml = Bun.YAML.parse(text) as never as Record<string, Record<string, never>>
    expect(yaml['config-version']).toBe(3 as never)
    expect(yaml.settings).toEqual({
      'internal-webserver': { enabled: false, port: 8080 },
      'web-address': 'x',
    } as never)
    expect(yaml['world-settings']!.default).toEqual({
      map: { render: { background: { workers: 3 } } },
      'player-tracker': { enabled: false, nameplate: { 'show-head': false } },
    } as never)
    expect(yaml['world-settings']!['minecraft:the_end']).toEqual({
      map: { enabled: false },
    } as never)
    // Nothing more to change.
    expect(squaremapConfig(text, { map: { public: false, players: false }, cores: 2 })).toBeNull()
  })

  it('gives big machines no worker suggestion', () => {
    const text = squaremapConfig(null, { map: readMapSettings(null), cores: 8 })!
    expect(text).not.toContain('workers')
  })

  it('leaves tiles out of backups, but not the rest of the map folder', () => {
    expect(isExcluded('squaremap/web/tiles')).toBe(true)
    expect(isExcluded('plugins/squaremap/web/tiles')).toBe(true)
    expect(isExcluded('squaremap/config.yml')).toBe(false)
    expect(isExcluded('squaremap/web')).toBe(false)
  })
})

async function setup(opts: { loader?: 'fabric' | 'paper' | 'vanilla'; installed?: boolean } = {}) {
  const db = openDb(':memory:')
  const servers = mkdtempSync(join(tmpdir(), 'ft-map-'))
  const dir = join(servers, 'survival')
  mkdirSync(dir, { recursive: true })
  db.insert(schema.servers)
    .values({
      name: 'survival',
      displayName: 'Survival',
      loader: opts.loader ?? 'fabric',
      mcVersion: '26.3',
      javaMajor: 25,
      memoryMb: 4096,
      port: 25565,
      rconPort: 25575,
      rconPassword: 'x',
      eulaAcceptedAt: new Date(),
    })
    .run()
  if (opts.installed !== false) {
    await writeLock(dir, {
      version: 1,
      updatedAt: new Date().toISOString(),
      content: [
        {
          source: 'modrinth',
          projectId: 'PFb7ZqK6',
          slug: 'squaremap',
          title: 'squaremap',
          versionId: 'v',
          versionNumber: '1.4.3',
          kind: 'mod',
          path: 'mods/squaremap.jar',
          url: 'https://cdn.test/squaremap',
          sha256: '',
          size: 1,
          requiredBy: [],
        },
      ],
    })
  }
  let state = 'active'
  const commands: string[] = []
  const agent = (async (verb: Verb) => {
    if (verb === 'service.status') return { active: state, since: null }
    return {}
  }) as AgentCall
  const service = new MapService({
    db,
    serverDir: (n) => join(servers, n),
    agent,
    rcon: async (_n, c) => {
      commands.push(c)
      return ''
    },
    cores: () => 2,
  })
  return { db, dir, service, commands, stop: () => void (state = 'inactive') }
}

describe('map service', () => {
  it('says why a server has no map yet', async () => {
    expect(await (await setup({ loader: 'vanilla' })).service.status('survival')).toEqual({
      blocked: 'loader',
      ready: false,
    })
    expect(await (await setup({ installed: false })).service.status('survival')).toEqual({
      blocked: 'not-installed',
      ready: false,
    })
    const { service, dir } = await setup()
    expect(await service.status('survival')).toEqual({ blocked: null, ready: false })
    mkdirSync(join(dir, 'squaremap', 'web'), { recursive: true })
    writeFileSync(join(dir, 'squaremap', 'web', 'index.html'), '<!doctype html>')
    expect(await service.status('survival')).toEqual({ blocked: null, ready: true })
  })

  it('writes the config before squaremap first starts, without asking it to reload', async () => {
    const { service, dir, commands } = await setup({ loader: 'paper' })
    await service.sync('survival')
    const file = join(dir, 'plugins', 'squaremap', 'config.yml')
    expect(readFileSync(file, 'utf8')).toContain('enabled: false')
    expect(statSync(file).mode & 0o777).toBe(0o660)
    expect(commands).toEqual([])
  })

  it('reloads squaremap when a running server picks up a change', async () => {
    const { service, db, dir, commands, stop } = await setup()
    await service.sync('survival')
    // squaremap has made its own since.
    await service.sync('survival')
    expect(commands).toEqual([])
    db.update(schema.servers)
      .set({ map: { public: false, players: false } })
      .run()
    await service.sync('survival')
    expect(commands).toEqual(['squaremap reload'])
    expect(readFileSync(join(dir, 'squaremap', 'config.yml'), 'utf8')).toMatch(
      /player-tracker:\s+enabled: false/,
    )
    stop()
    db.update(schema.servers)
      .set({ map: { public: false, players: true } })
      .run()
    await service.sync('survival')
    expect(commands).toEqual(['squaremap reload'])
  })

  it('leaves servers without squaremap alone', async () => {
    const { service, dir } = await setup({ installed: false })
    await service.syncAll()
    expect(existsSync(join(dir, 'squaremap'))).toBe(false)
  })
})

describe('serving the map', () => {
  const root = '/srv/flytower/servers/survival/squaremap/web'

  it('finds files inside the web folder only', () => {
    expect(mapFile(root, '')).toEqual({
      file: `${root}/index.html`,
      type: 'text/html; charset=utf-8',
      cache: 'no-cache',
    })
    expect(mapFile(root, 'tiles/minecraft_overworld/3/0_0.png')).toMatchObject({
      file: `${root}/tiles/minecraft_overworld/3/0_0.png`,
      type: 'image/png',
      cache: 'public, max-age=60',
    })
    expect(mapFile(root, 'tiles/players.json')?.cache).toBe('no-cache')
    expect(mapFile(root, 'assets/index-B-TqULzJ.js')?.cache).toContain('immutable')
    for (const bad of [
      '../config.yml',
      'tiles/../../config.yml',
      '/etc/passwd',
      '.hidden.png',
      'tiles//x.png',
      'x.png\0',
      'tiles\\x.png',
      'assets/index.js.map',
      'config.yml',
    ]) {
      expect(mapFile(root, bad)).toBeNull()
    }
  })

  it('opens public maps to anyone, and private ones to people who can see the server', () => {
    const pub = { public: true, players: true }
    const priv = { public: false, players: true }
    expect(mapAccess({ map: pub, publicPage: true, canView: null })).toBe('allow')
    // A public map with the page off is private.
    expect(mapAccess({ map: pub, publicPage: false, canView: null })).toBe('sign-in')
    expect(mapAccess({ map: priv, publicPage: true, canView: null })).toBe('sign-in')
    expect(mapAccess({ map: priv, publicPage: true, canView: false })).toBe('not-found')
    expect(mapAccess({ map: priv, publicPage: false, canView: true })).toBe('allow')
  })

  it('lets nothing load from other sites', () => {
    expect(MAP_CSP).toContain("default-src 'self'")
    expect(MAP_CSP).not.toContain('https:')
    expect(MAP_CSP).toContain("frame-ancestors 'none'")
  })
})

describe('drawing the map', () => {
  it('draws or stops a dimension over the console, and says what squaremap said', async () => {
    const { service, commands } = await setup()
    expect(await service.render('survival', 'full', 'the_nether')).toBe('Started drawing the map.')
    expect(await service.render('survival', 'cancel', 'overworld')).toBe('Stopped drawing.')
    expect(commands).toEqual([
      'squaremap fullrender minecraft:the_nether',
      'squaremap cancelrender minecraft:overworld',
    ])
    expect(plainReply('<red>Render already in progress for §aminecraft:overworld')).toBe(
      'Render already in progress for minecraft:overworld',
    )
  })

  it('refuses when it cannot', async () => {
    await expect(
      (await setup({ installed: false })).service.render('survival', 'full', 'overworld'),
    ).rejects.toThrow('Add squaremap')
    const stopped = await setup()
    stopped.stop()
    await expect(stopped.service.render('survival', 'full', 'overworld')).rejects.toThrow(
      'Start the server',
    )
  })

  it('forgets the tiles of a replaced world, and nothing else', async () => {
    const { service, dir } = await setup()
    mkdirSync(join(dir, 'squaremap', 'web', 'tiles', 'minecraft_overworld'), { recursive: true })
    writeFileSync(join(dir, 'squaremap', 'web', 'index.html'), '')
    writeFileSync(join(dir, 'squaremap', 'config.yml'), '')
    await service.clearTiles('survival')
    expect(existsSync(join(dir, 'squaremap', 'web', 'tiles'))).toBe(false)
    expect(existsSync(join(dir, 'squaremap', 'web', 'index.html'))).toBe(true)
    expect(existsSync(join(dir, 'squaremap', 'config.yml'))).toBe(true)
  })
})
