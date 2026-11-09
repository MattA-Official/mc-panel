import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { AgentError, type Verb } from '@flytower/protocol'
import type { Fetch, LoaderProvider, ResolvedServer } from '@flytower/providers'
import { openDb, schema } from '../server/db'
import { Bus } from '../server/jobs/bus'
import { defaultProperties } from '../server/jobs/properties'
import { JobRunner, lowestFree, type AgentCall, type JobEvent } from '../server/jobs/runner'

const JAR = 'pretend jar'
const sha1 = (s: string) => new Bun.CryptoHasher('sha1').update(s).digest('hex')

function setup(
  opts: { hash?: string; status?: string[]; failVerb?: Verb; resolveError?: Error } = {},
) {
  const db = openDb(':memory:')
  const root = mkdtempSync(join(tmpdir(), 'ft-jobs-'))
  const calls: [Verb, unknown][] = []
  const statuses = [...(opts.status ?? ['activating', 'active'])]

  const agent = (async (verb: Verb, params: unknown) => {
    calls.push([verb, params])
    if (verb === opts.failVerb) throw new AgentError('failed', `${verb} broke`)
    switch (verb) {
      case 'runtime.install':
        return { javaHome: '/opt/j', version: '25', alreadyInstalled: false }
      case 'server.create':
        return { directory: root, user: 'mc-x', unit: 'u' }
      case 'service.status':
        return { active: statuses.shift() ?? 'active', since: null }
      case 'server.delete':
        return { archivedTo: null }
      default:
        return {}
    }
  }) as AgentCall

  const resolved: ResolvedServer = {
    url: 'https://example.test/server.jar',
    hash: { algorithm: 'sha1', value: opts.hash ?? sha1(JAR) },
    javaMajor: 25,
    loaderVersion: null,
  }
  const vanilla: LoaderProvider = {
    id: 'vanilla',
    name: 'Vanilla',
    minecraftVersions: async () => [],
    loaderVersions: async () => [],
    resolve: async () => {
      if (opts.resolveError) throw opts.resolveError
      return resolved
    },
  }
  const fetch: Fetch = async () => new Response(JAR)
  const bus = new Bus()
  const runner = new JobRunner({
    db,
    agent,
    loaders: { vanilla, fabric: vanilla },
    fetch,
    bus,
    sleep: async () => {},
  })
  return { db, root, calls, runner, bus }
}

const input = {
  name: 'survival',
  displayName: 'Survival',
  loader: 'vanilla' as const,
  mcVersion: '26.3',
  memoryMb: 4096,
  acceptEula: true as const,
}

describe('create-server job', () => {
  it('runs every step and leaves a ready server', async () => {
    const { db, root, calls, runner, bus } = setup()
    const seen: JobEvent[] = []
    const { jobId, done } = runner.createServer(input)
    bus.subscribe(`job:${jobId}`, (e) => seen.push(e as JobEvent))
    const final = await done

    expect(final).toMatchObject({ state: 'succeeded', progress: 100, step: 'Done' })
    expect(calls.map((c) => c[0])).toEqual([
      'runtime.install',
      'server.create',
      'service.start',
      'service.status',
      'service.status',
    ])
    expect(calls[1]![1]).toEqual({ name: 'survival', port: 25565, memoryMb: 4096, javaMajor: 25 })
    expect(await readFile(join(root, 'server.jar'), 'utf8')).toBe(JAR)
    expect(await readFile(join(root, 'eula.txt'), 'utf8')).toContain('eula=true')
    const props = await readFile(join(root, 'server.properties'), 'utf8')
    expect(props).toContain('server-port=25565')
    expect(props).toContain('rcon.port=25575')
    expect((await stat(join(root, 'server.properties'))).mode & 0o777).toBe(0o660)

    const server = db.select().from(schema.servers).get()!
    expect(server).toMatchObject({ name: 'survival', port: 25565, rconPort: 25575, javaMajor: 25 })
    expect(props).toContain(`rcon.password=${server.rconPassword}`)
    expect(seen.map((e) => e.progress)).toEqual(
      [...seen.map((e) => e.progress)].sort((a, b) => a - b),
    )
    expect(runner.get(jobId)?.state).toBe('succeeded')
  })

  it("carries a spec's properties, backups and content into a new server", async () => {
    const { db, root, runner } = setup()
    const final = await runner.createServer(input, undefined, {
      properties: { motd: 'From YAML', 'max-players': '30' },
      backups: {
        schedule: '0 4 * * *',
        timezone: 'Europe/London',
        keep: { last: 3, daily: 2, weekly: 1 },
      },
      content: [{ modrinth: 'lithium' }],
    }).done
    expect(final).toMatchObject({ state: 'succeeded' })
    const props = await readFile(join(root, 'server.properties'), 'utf8')
    expect(props).toContain('motd=From YAML')
    expect(props).toContain('max-players=30')
    expect(props).toContain('rcon.port=25575')
    expect(db.select().from(schema.servers).get()).toMatchObject({
      backupSchedule: '0 4 * * *',
      backupTz: 'Europe/London',
      keepLast: 3,
      content: [{ modrinth: 'lithium' }],
    })
  })

  it('picks the next free ports for a second server', async () => {
    const { runner, calls } = setup()
    await runner.createServer(input).done
    await runner.createServer({ ...input, name: 'creative' }).done
    const creates = calls.filter((c) => c[0] === 'server.create').map((c) => c[1])
    expect(creates[1]).toMatchObject({ port: 25566 })
  })

  it('refuses a name or port that is taken, before starting a job', async () => {
    const { runner } = setup()
    await runner.createServer(input).done
    expect(() => runner.createServer(input)).toThrow("There's already a server called survival.")
    expect(() => runner.createServer({ ...input, name: 'other', port: 25575 })).toThrow(
      'Port 25575 is already used',
    )
  })

  it('refuses without the EULA', () => {
    const { runner } = setup()
    expect(() => runner.createServer({ ...input, acceptEula: false as true })).toThrow(
      'You need to accept the Minecraft EULA.',
    )
  })

  it('rolls back the OS side when the download fails its checksum', async () => {
    const { db, runner, calls } = setup({ hash: '0'.repeat(40) })
    const final = await runner.createServer(input).done
    expect(final.state).toBe('failed')
    expect(final.message).toContain("didn't match its published checksum")
    expect(calls.at(-1)).toEqual(['server.delete', { name: 'survival' }])
    expect(db.select().from(schema.servers).all()).toHaveLength(0)
    // The name is free again.
    expect(() => runner.createServer({ ...input, mcVersion: '26.3' })).not.toThrow()
  })

  it('fails cleanly, without rollback, if nothing was created yet', async () => {
    const { runner, calls } = setup({ failVerb: 'runtime.install' })
    const final = await runner.createServer(input).done
    expect(final).toMatchObject({ state: 'failed', step: 'Installing Java' })
    expect(final.message).toBe('The system helper said: runtime.install broke')
    expect(calls.some((c) => c[0] === 'server.delete')).toBe(false)
  })

  it('reports a server that crashes on start', async () => {
    const { runner } = setup({ status: ['activating', 'failed'] })
    const final = await runner.createServer(input).done
    expect(final.message).toBe('The server failed to start. Check its log.')
  })

  it('marks cut-off jobs failed at boot', () => {
    const { db, runner } = setup()
    db.insert(schema.jobs).values({ kind: 'server.create', state: 'running' }).run()
    db.insert(schema.jobs).values({ kind: 'server.create', state: 'succeeded' }).run()
    expect(runner.recover()).toBe(1)
    expect(runner.get(1)?.message).toContain('The panel restarted')
    expect(runner.get(2)?.state).toBe('succeeded')
  })
})

describe('helpers', () => {
  it('lowestFree skips used ports', () => {
    expect(lowestFree(25565, new Set([25565, 25566, 25568]))).toBe(25567)
  })

  it('escapes the motd', () => {
    const p = defaultProperties({ port: 1, rconPort: 2, rconPassword: 'x', motd: 'Café\nTwo' })
    expect(p).toContain('motd=Caf\\u00e9 Two')
  })
})

describe('import', () => {
  function staged() {
    const src = mkdtempSync(join(tmpdir(), 'ft-import-'))
    mkdirSync(join(src, 'mods'))
    mkdirSync(join(src, 'smp'))
    mkdirSync(join(src, 'libraries'))
    writeFileSync(join(src, 'mods', 'lithium.jar'), 'mod')
    writeFileSync(join(src, 'smp', 'level.dat'), 'world')
    writeFileSync(
      join(src, 'server.properties'),
      '#mine\nlevel-name=smp\nmotd=Old motd\nrcon.password=leaked\n',
    )
    writeFileSync(join(src, 'fabric-server-launch.jar'), 'old launcher')
    writeFileSync(join(src, 'whitelist.json'), '[]')
    return src
  }

  it('moves the files in, keeps their properties and sets the managed keys', async () => {
    const { root, runner, calls } = setup()
    const src = staged()
    const final = await runner.createServer(input, { root: src, kind: 'server' }).done
    expect(final.state).toBe('succeeded')
    expect(calls.map((c) => c[0])).toContain('server.permissions')
    expect(readdirSync(root).sort()).toEqual(
      ['eula.txt', 'mods', 'server.jar', 'server.properties', 'smp', 'whitelist.json'].sort(),
    )
    const props = await readFile(join(root, 'server.properties'), 'utf8')
    expect(props).toContain('#mine\nlevel-name=smp\nmotd=Old motd\n')
    expect(props).toContain('server-port=25565')
    expect(props).not.toContain('leaked')
    expect(await readFile(join(root, 'server.jar'), 'utf8')).toBe(JAR)
    // Left behind in staging: the old jar and caches.
    expect(readdirSync(src).sort()).toEqual(['fabric-server-launch.jar', 'libraries'])
  })

  it('makes a bare world the server world', async () => {
    const { root, runner } = setup()
    const src = mkdtempSync(join(tmpdir(), 'ft-import-'))
    const world = join(src, 'My World')
    mkdirSync(world)
    writeFileSync(join(world, 'level.dat'), 'w')
    expect((await runner.createServer(input, { root: world, kind: 'world' }).done).state).toBe(
      'succeeded',
    )
    expect(await readFile(join(root, 'world', 'level.dat'), 'utf8')).toBe('w')
    expect(await readFile(join(root, 'server.properties'), 'utf8')).toContain('motd=Survival')
  })

  it('puts the files back if the server fails to start', async () => {
    const { runner } = setup({ status: ['failed'] })
    const src = staged()
    const final = await runner.createServer(input, { root: src, kind: 'server' }).done
    expect(final.state).toBe('failed')
    expect(readdirSync(src)).toContain('mods')
    expect(readdirSync(src)).toContain('smp')
  })
})
