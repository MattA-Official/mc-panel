import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import type { Verb } from '@flytower/protocol'
import {
  vanillaTweaksProvider,
  ProviderError,
  type ContentProvider,
  type ContentRef,
  type ResolvedContent,
} from '@flytower/providers'
import { eq } from 'drizzle-orm'
import { ServerSpec, type ServerSpecInput } from '../shared/spec'
import { openDb, schema } from '../server/db'
import { JobRunner, type AgentCall } from '../server/jobs/runner'
import { SpecService } from '../server/spec/apply'
import { writeZip } from '../server/zip'
import { LOCK_FILE, readLock } from '../server/spec/lock'
import { parseProperties, stringifyProperties, setProperties, toRecord } from '../server/properties'

const sha512 = (s: string) => new Bun.CryptoHasher('sha512').update(s).digest('hex')

/** A tiny catalogue: project → versions (newest first), each with a body. */
const CATALOGUE: Record<
  string,
  { title: string; versions: string[]; deps?: string[]; kind?: 'mod' | 'datapack' }
> = {
  lithium: { title: 'Lithium', versions: ['0.19', '0.18'] },
  chunky: { title: 'Chunky', versions: ['1.4'], deps: ['fabric-api'] },
  'fabric-api': { title: 'Fabric API', versions: ['0.100'] },
  terralith: { title: 'Terralith', versions: ['2.5'], kind: 'datapack' },
}

function fakeModrinth(opts: { badHash?: string } = {}): ContentProvider {
  const make = (slug: string, version: string): ResolvedContent => {
    const p = CATALOGUE[slug]!
    const kind = p.kind ?? 'mod'
    return {
      source: 'modrinth',
      projectId: `id-${slug}`,
      slug,
      title: p.title,
      versionId: `${slug}@${version}`,
      versionNumber: version,
      kind,
      filename: `${slug}-${version}.${kind === 'mod' ? 'jar' : 'zip'}`,
      url: `https://cdn.test/${slug}/${version}`,
      hash: {
        algorithm: 'sha512',
        value: opts.badHash === slug ? 'f'.repeat(128) : sha512(`${slug}@${version}`),
      },
      size: 100,
      dependencies: (p.deps ?? []).map((d) => ({ projectId: `id-${d}`, versionId: null })),
      incompatible: [],
    }
  }
  return {
    id: 'modrinth',
    name: 'Fake',
    search: async () => ({ hits: [], total: 0 }),
    versions: async () => [],
    resolve: async (ref: ContentRef) => {
      const slug = ref.project.replace(/^id-/, '')
      const p = CATALOGUE[slug]
      if (!p) throw new ProviderError(`No project ${ref.project}`)
      const version = ref.version ? ref.version.replace(/^.*@/, '') : p.versions[0]!
      if (!p.versions.includes(version))
        throw new ProviderError(`${p.title} has no version "${version}".`)
      return make(slug, version)
    },
  }
}

// A Vanilla Tweaks download: a zip holding one datapack zip, both with names at the root.
const vtDir = mkdtempSync(join(tmpdir(), 'ft-vt-'))
writeFileSync(join(vtDir, 'pack.mcmeta'), '{"pack":{"pack_format":80}}')
const entry = (name: string, source: string) => ({
  name,
  source,
  size: Bun.file(source).size,
  mtime: new Date(),
  mode: 0o644,
})
await writeZip([entry('pack.mcmeta', join(vtDir, 'pack.mcmeta'))], join(vtDir, 'inner.zip'))
await writeZip(
  [entry('graves v3.0.0 (MC 26.3).zip', join(vtDir, 'inner.zip'))],
  join(vtDir, 'wrapped.zip'),
)
const INNER = readFileSync(join(vtDir, 'inner.zip'))
const WRAPPED = readFileSync(join(vtDir, 'wrapped.zip'))

const fetchFiles = (async (input: string | URL | Request) => {
  const url = String(input)
  const m = /cdn\.test\/([^/]+)\/(.+)$/.exec(url)
  if (m) return new Response(`${m[1]}@${m[2]}`)
  if (url.endsWith('/26.3/dpcategories.json')) {
    return Response.json({
      categories: [
        { category: 'Survival', packs: [{ name: 'graves', display: 'Graves', version: '3.0.0' }] },
      ],
    })
  }
  if (url.endsWith('/26.3/ctcategories.json')) return Response.json({ categories: [] })
  if (url.endsWith('/zipdatapacks.php')) {
    return Response.json({ status: 'success', link: '/download/VanillaTweaks_d1_UNZIP_ME.zip' })
  }
  if (url.endsWith('/download/VanillaTweaks_d1_UNZIP_ME.zip')) return new Response(WRAPPED)
  return new Response('', { status: 404 })
}) as never

function setup(opts: { running?: boolean; loader?: 'vanilla' | 'fabric'; badHash?: string } = {}) {
  const db = openDb(':memory:')
  const base = mkdtempSync(join(tmpdir(), 'ft-spec-'))
  const servers = join(base, 'servers')
  const dir = join(servers, 'survival')
  mkdirSync(join(dir, 'world'), { recursive: true })
  writeFileSync(join(dir, 'server.properties'), 'server-port=25565\nmotd=Hello\nenable-rcon=true\n')
  db.insert(schema.servers)
    .values({
      name: 'survival',
      displayName: 'Survival',
      loader: opts.loader ?? 'fabric',
      mcVersion: '26.3',
      loaderVersion: '0.20.1',
      javaMajor: 25,
      memoryMb: 4096,
      port: 25565,
      rconPort: 25575,
      rconPassword: 'x',
      eulaAcceptedAt: new Date(),
    })
    .run()
  db.insert(schema.servers)
    .values({
      name: 'creative',
      displayName: 'Creative',
      loader: 'vanilla',
      mcVersion: '26.3',
      javaMajor: 25,
      memoryMb: 2048,
      port: 25566,
      rconPort: 25576,
      rconPassword: 'y',
      eulaAcceptedAt: new Date(),
    })
    .run()

  let state = opts.running ? 'active' : 'inactive'
  const calls: string[] = []
  const agent = (async (verb: Verb, params: unknown) => {
    calls.push(verb === 'server.configure' ? `${verb} ${JSON.stringify(params)}` : verb)
    if (verb === 'service.status') return { active: state, since: null }
    if (verb === 'service.stop') state = 'inactive'
    if (verb === 'service.start') state = 'active'
    return {}
  }) as AgentCall
  const runner = new JobRunner({
    db,
    agent,
    loaders: {} as never,
    fetch: fetchFiles,
    sleep: async () => {},
  })
  let locked = false
  const snapshots: string[] = []
  const propsPath = join(dir, 'server.properties')
  const service = new SpecService({
    db,
    serverDir: (n) => join(servers, n),
    agent,
    jobs: runner,
    backups: {
      lock: () => {
        if (locked) throw new Error('busy')
        locked = true
        return () => void (locked = false)
      },
      snapshot: async (_n, note) => {
        snapshots.push(note)
        return {} as never
      },
    },
    modrinth: fakeModrinth(opts),
    vanillatweaks: vanillaTweaksProvider(fetchFiles, 'https://vt.test'),
    fetch: fetchFiles,
    readProperties: async () => toRecord(parseProperties(readFileSync(propsPath, 'utf8'))),
    writeProperties: async (_n, changes) =>
      writeFileSync(
        propsPath,
        stringifyProperties(
          setProperties(parseProperties(readFileSync(propsPath, 'utf8')), changes),
        ),
      ),
    sleep: async () => {},
  })
  const spec = (extra: Partial<ServerSpecInput> = {}) =>
    ServerSpec.parse({
      name: 'survival',
      loader: { type: opts.loader ?? 'fabric', minecraft: '26.3' },
      ...extra,
    })
  return { db, dir, service, calls, snapshots, spec }
}

describe('plan', () => {
  it('lists content to add, with dependencies and why', async () => {
    const { service, spec } = setup()
    const plan = await service.plan(
      'survival',
      spec({ content: [{ modrinth: 'chunky' }, { modrinth: 'lithium' }] }),
    )
    expect(plan.problems).toEqual([])
    expect(plan.changes).toEqual([
      { area: 'content', action: 'add', label: 'Chunky', to: '1.4', note: undefined },
      { area: 'content', action: 'add', label: 'Lithium', to: '0.19', note: undefined },
      {
        area: 'content',
        action: 'add',
        label: 'Fabric API',
        to: '0.100',
        note: 'Needed by Chunky',
      },
    ])
    expect(plan.backup).toBe(true)
    expect(plan.restart).toBe(true)
    expect(plan.downloadBytes).toBe(300)
    expect(plan).not.toHaveProperty('work')
  })

  it('an unchanged spec plans nothing', async () => {
    const { service, spec } = setup()
    const plan = await service.plan('survival', spec())
    expect(plan.changes).toEqual([])
    expect(plan.restart).toBe(false)
    expect(plan.backup).toBe(false)
  })

  it('diffs settings, properties and backups, leaving out what the spec leaves out', async () => {
    const { service, spec } = setup()
    const plan = await service.plan(
      'survival',
      spec({
        displayName: 'Big Survival',
        memory: '6G',
        port: 25570,
        properties: { motd: 'Hello', 'max-players': 30 },
        backups: { schedule: '0 4 * * *' },
      }),
    )
    expect(plan.changes.map((c) => `${c.action} ${c.label} ${c.from ?? ''}→${c.to}`)).toEqual([
      'set Display name Survival→Big Survival',
      'set Memory 4G→6G',
      'set Port 25565→25570',
      'add max-players →30',
      'set Backups off, keep 6/7/4→0 4 * * * (UTC), keep 6/7/4',
    ])
    expect(plan.restart).toBe(true)
    expect(plan.backup).toBe(false)
  })

  it('refuses a port clash, a new name, a loader change and mods on vanilla', async () => {
    const { service, spec } = setup({ loader: 'vanilla' })
    expect((await service.plan('survival', spec({ port: 25566 }))).problems).toEqual([
      'Port 25566 is already used by creative.',
    ])
    expect((await service.plan('survival', spec({ name: 'other' }))).problems[0]).toContain(
      "Names can't change",
    )
    const loader = await service.plan(
      'survival',
      ServerSpec.parse({ name: 'survival', loader: { type: 'fabric', minecraft: '26.3' } }),
    )
    expect(loader.problems[0]).toContain('later release')
    const mods = await service.plan('survival', spec({ content: [{ modrinth: 'lithium' }] }))
    expect(mods.problems).toContain("Lithium is a mod, which a vanilla server can't run.")
    const datapack = await service.plan('survival', spec({ content: [{ modrinth: 'terralith' }] }))
    expect(datapack.problems).toEqual([])
  })

  it('flags hand-added files that are in the way, and lists unmanaged ones', async () => {
    const { service, spec, dir } = setup()
    mkdirSync(join(dir, 'mods'))
    writeFileSync(join(dir, 'mods', 'lithium-0.19.jar'), 'by hand')
    writeFileSync(join(dir, 'mods', 'other.jar'), 'by hand')
    const plan = await service.plan('survival', spec({ content: [{ modrinth: 'lithium' }] }))
    expect(plan.unmanaged).toEqual(['mods/lithium-0.19.jar', 'mods/other.jar'])
    expect(plan.problems[0]).toContain('added by hand')
  })
})

describe('apply', () => {
  it('installs content and writes the lockfile, restarting a running server', async () => {
    const { service, spec, dir, calls, snapshots, db } = setup({ running: true })
    const plan = await service.plan(
      'survival',
      spec({ content: [{ modrinth: 'chunky' }, { modrinth: 'terralith' }] }),
    )
    const { done } = await service.apply('survival', plan.id)
    expect(await done).toMatchObject({ state: 'succeeded' })
    expect(readFileSync(join(dir, 'mods', 'chunky-1.4.jar'), 'utf8')).toBe('chunky@1.4')
    expect(existsSync(join(dir, 'mods', 'fabric-api-0.100.jar'))).toBe(true)
    expect(existsSync(join(dir, 'world', 'datapacks', 'terralith-2.5.zip'))).toBe(true)
    expect(existsSync(join(dir, '.flytower-staging'))).toBe(false)
    const lock = await readLock(dir)
    expect(lock.content.map((l) => l.path)).toEqual([
      'mods/chunky-1.4.jar',
      'mods/fabric-api-0.100.jar',
      'world/datapacks/terralith-2.5.zip',
    ])
    expect(lock.content[0]!.sha256).toBe(
      new Bun.CryptoHasher('sha256').update('chunky@1.4').digest('hex'),
    )
    expect(snapshots).toEqual(['Before applying spec changes'])
    expect(calls).toContain('service.stop')
    expect(calls.at(-2)).toBe('service.start')
    const row = db.select().from(schema.servers).where(eq(schema.servers.name, 'survival')).get()!
    expect(row.content).toEqual([{ modrinth: 'chunky' }, { modrinth: 'terralith' }])
  })

  it('keeps locked versions, upgrades when asked, and removes what was dropped', async () => {
    const { service, spec, dir } = setup()
    const first = await service.plan(
      'survival',
      spec({ content: [{ modrinth: 'lithium', version: '0.18' }, { modrinth: 'chunky' }] }),
    )
    await (
      await service.apply('survival', first.id)
    ).done

    // Unpinned now, but the lockfile keeps 0.18.
    const same = await service.plan(
      'survival',
      spec({ content: [{ modrinth: 'lithium' }, { modrinth: 'chunky' }] }),
    )
    expect(same.changes).toEqual([])

    const up = await service.plan('survival', spec({ content: [{ modrinth: 'lithium' }] }), [
      'lithium',
    ])
    expect(up.changes.map((c) => `${c.action} ${c.label}`)).toEqual([
      'update Lithium',
      'remove Chunky',
      'remove Fabric API',
    ])
    expect(await (await service.apply('survival', up.id)).done).toMatchObject({
      state: 'succeeded',
    })
    expect(existsSync(join(dir, 'mods', 'lithium-0.18.jar'))).toBe(false)
    expect(existsSync(join(dir, 'mods', 'lithium-0.19.jar'))).toBe(true)
    expect(existsSync(join(dir, 'mods', 'chunky-1.4.jar'))).toBe(false)
  })

  it('reinstalls a locked file that has gone missing', async () => {
    const { service, spec, dir } = setup()
    const s = spec({ content: [{ modrinth: 'lithium' }] })
    await (
      await service.apply('survival', (await service.plan('survival', s)).id)
    ).done
    Bun.spawnSync(['rm', join(dir, 'mods', 'lithium-0.19.jar')])
    const plan = await service.plan('survival', s)
    expect(plan.changes).toMatchObject([{ action: 'reinstall', label: 'Lithium' }])
  })

  it('a bad download changes nothing and leaves the server running', async () => {
    const { service, spec, dir, calls } = setup({ running: true, badHash: 'chunky' })
    const plan = await service.plan(
      'survival',
      spec({ content: [{ modrinth: 'lithium' }, { modrinth: 'chunky' }] }),
    )
    const final = await (await service.apply('survival', plan.id)).done
    expect(final).toMatchObject({ state: 'failed' })
    expect(final.message).toContain('checksum')
    expect(existsSync(join(dir, 'mods'))).toBe(false)
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false)
    expect(calls).not.toContain('service.stop')
  })

  it('saves settings through the agent and server.properties without a restart when stopped', async () => {
    const { service, spec, dir, calls, db } = setup()
    const plan = await service.plan(
      'survival',
      spec({ memory: '6G', port: 25570, properties: { motd: 'Hi' } }),
    )
    expect(await (await service.apply('survival', plan.id)).done).toMatchObject({
      state: 'succeeded',
    })
    expect(calls).toContain('server.configure {"name":"survival","memoryMb":6144,"port":25570}')
    expect(calls).not.toContain('service.start')
    const props = readFileSync(join(dir, 'server.properties'), 'utf8')
    expect(props).toContain('server-port=25570')
    expect(props).toContain('motd=Hi')
    const row = db.select().from(schema.servers).where(eq(schema.servers.name, 'survival')).get()!
    expect(row).toMatchObject({ memoryMb: 6144, port: 25570 })
  })

  it('refuses a stale, unknown or blocked plan', async () => {
    const { service, spec, dir } = setup()
    const plan = await service.plan('survival', spec({ properties: { motd: 'Hi' } }))
    writeFileSync(join(dir, 'server.properties'), 'motd=Changed by hand\n')
    await expect(service.apply('survival', plan.id)).rejects.toThrow('changed since')
    await expect(service.apply('survival', 'nope')).rejects.toThrow('expired')
    const blocked = await service.plan('survival', spec({ port: 25566 }))
    await expect(service.apply('survival', blocked.id)).rejects.toThrow('already used')
  })
})

describe('content listing', () => {
  it('tells asked-for items from dependencies, and lists pending and hand-added files', async () => {
    const { service, spec, dir, db } = setup()
    const plan = await service.plan('survival', spec({ content: [{ modrinth: 'chunky' }] }))
    await (
      await service.apply('survival', plan.id)
    ).done
    writeFileSync(join(dir, 'mods', 'handmade.jar'), 'x')
    db.update(schema.servers)
      .set({ content: [{ modrinth: 'chunky' }, { modrinth: 'lithium' }] })
      .where(eq(schema.servers.name, 'survival'))
      .run()
    const list = await service.content('survival')
    expect(list.accepts).toEqual(['mod', 'datapack'])
    expect(list.items.map((i) => [i.slug, i.asked, i.requiredBy])).toEqual([
      ['chunky', true, []],
      ['fabric-api', false, ['Chunky']],
    ])
    expect(list.pending).toEqual([{ modrinth: 'lithium' }])
    expect(list.unmanaged).toEqual([{ path: 'mods/handmade.jar', kind: 'mod' }])
    expect((await service.currentSpec('survival')).content).toHaveLength(2)
  })
})

describe('vanilla tweaks', () => {
  it('installs the datapack from inside the wrapper zip, on a vanilla server', async () => {
    const { service, spec, dir } = setup({ loader: 'vanilla' })
    const plan = await service.plan(
      'survival',
      spec({ content: [{ vanillatweaks: 'Survival/graves' }] }),
    )
    expect(plan.problems).toEqual([])
    expect(plan.changes).toMatchObject([{ action: 'add', label: 'Graves', to: '3.0.0' }])
    expect(await (await service.apply('survival', plan.id)).done).toMatchObject({
      state: 'succeeded',
    })
    const installed = readFileSync(join(dir, 'world', 'datapacks', 'vt-graves.zip'))
    expect(Buffer.compare(installed, INNER)).toBe(0)
    const lock = await readLock(dir)
    expect(lock.content[0]).toMatchObject({
      source: 'vanillatweaks',
      projectId: 'datapack:Survival/graves',
      sha256: new Bun.CryptoHasher('sha256').update(INNER).digest('hex'),
    })
    const listing = await service.content('survival')
    expect(listing.items[0]!.asked).toBe(true)
    expect(listing.pending).toEqual([])
    const again = await service.plan(
      'survival',
      spec({ content: [{ vanillatweaks: 'Survival/graves' }] }),
    )
    expect(again.changes).toEqual([])
  })
})
