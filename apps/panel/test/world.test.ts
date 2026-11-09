import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import type { Verb } from '@flytower/protocol'
import { openDb, schema } from '../server/db'
import { JobRunner, type AgentCall } from '../server/jobs/runner'
import { writeLock } from '../server/spec/lock'
import { parseProperties, setProperties, stringifyProperties, toRecord } from '../server/properties'
import { parseProgress, startCommands } from '../server/world/chunky'
import { WorldService } from '../server/world/service'

describe('chunky', () => {
  it('reads progress lines', () => {
    expect(
      parseProgress(
        '[Chunky] Task running for minecraft:overworld. Processed: 1,234 chunks (5.67%), ETA: 0:12:34, Rate: 123.4 cps, Current: 12, -3',
      ),
    ).toEqual([
      { world: 'minecraft:overworld', chunks: 1234, percent: 5.67, eta: '0:12:34', rate: 123.4 },
    ])
    expect(parseProgress('[Chunky] No tasks running.')).toEqual([])
    expect(
      parseProgress(
        'Task finished for minecraft:the_end. Processed: 400 chunks (100.00%), Total time: 0:00:10',
      ),
    ).toMatchObject([{ world: 'minecraft:the_end', percent: 100, eta: null }])
  })

  it('builds start commands', () => {
    expect(
      startCommands({ dimension: 'overworld', radius: 2000, center: null, shape: 'square' }),
    ).toEqual([
      'chunky world minecraft:overworld',
      'chunky spawn',
      'chunky radius 2000',
      'chunky shape square',
      'chunky start',
    ])
    expect(
      startCommands({
        dimension: 'the_nether',
        radius: 500,
        center: { x: 10, z: -5 },
        shape: 'circle',
      })[1],
    ).toBe('chunky center 10 -5')
  })
})

async function setup(
  opts: { loader?: 'vanilla' | 'fabric'; chunky?: boolean; running?: boolean } = {},
) {
  const db = openDb(':memory:')
  const servers = mkdtempSync(join(tmpdir(), 'ft-world-'))
  const dir = join(servers, 'survival')
  mkdirSync(join(dir, 'world', 'region'), { recursive: true })
  mkdirSync(join(dir, 'world', 'datapacks'), { recursive: true })
  writeFileSync(join(dir, 'world', 'region', 'r.0.0.mca'), 'chunks')
  writeFileSync(join(dir, 'world', 'level.dat'), 'level')
  writeFileSync(join(dir, 'world', 'datapacks', 'graves.zip'), 'pack')
  writeFileSync(join(dir, 'server.properties'), 'level-seed=123\nmotd=Hi\n')
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
  if (opts.chunky !== false) {
    await writeLock(dir, {
      version: 1,
      updatedAt: new Date().toISOString(),
      content: [
        {
          source: 'modrinth',
          projectId: 'fALzjamp',
          slug: 'chunky',
          title: 'Chunky',
          versionId: 'v',
          versionNumber: '1.4',
          kind: 'mod',
          path: 'mods/chunky.jar',
          url: 'https://cdn.test/chunky',
          sha256: '',
          size: 1,
          requiredBy: [],
        },
      ],
    })
  }
  let state = opts.running === false ? 'inactive' : 'active'
  const calls: string[] = []
  const agent = (async (verb: Verb) => {
    calls.push(verb)
    if (verb === 'service.status') return { active: state, since: null }
    if (verb === 'service.stop') state = 'inactive'
    if (verb === 'service.start') state = 'active'
    return {}
  }) as AgentCall
  const sent: string[] = []
  const replies: Record<string, string> = {
    'chunky progress':
      'Task running for minecraft:overworld. Processed: 10 chunks (1.00%), ETA: 0:10:00, Rate: 5.0 cps',
    'chunky start': 'Task already exists. Use /chunky confirm to start a new one.',
    'chunky cancel': 'Use /chunky confirm to cancel all tasks.',
    'chunky confirm': 'Done.',
  }
  const snapshots: string[] = []
  const locked = new Set<string>()
  const propsPath = join(dir, 'server.properties')
  const runner = new JobRunner({
    db,
    agent,
    loaders: {} as never,
    fetch: fetch,
    sleep: async () => {},
  })
  const world = new WorldService({
    db,
    serverDir: (n) => join(servers, n),
    agent,
    jobs: runner,
    backups: {
      lock: (n) => {
        if (locked.has(n)) throw new Error('busy')
        locked.add(n)
        return () => void locked.delete(n)
      },
      snapshot: async (_n, note) => {
        snapshots.push(note)
        return {} as never
      },
      withSavesPaused: async (_s, _r, fn) => fn(),
      ensureSpace: async () => {},
    },
    rcon: async (_n, command) => {
      sent.push(command)
      return replies[command] ?? `ok: ${command}`
    },
    readProperties: async (n) =>
      toRecord(parseProperties(readFileSync(join(servers, n, 'server.properties'), 'utf8'))),
    writeProperties: async (_n, changes) =>
      writeFileSync(
        propsPath,
        stringifyProperties(
          setProperties(parseProperties(readFileSync(propsPath, 'utf8')), changes),
        ),
      ),
    sleep: async () => {},
  })
  // A second server whose world can be copied in.
  const other = join(servers, 'creative')
  mkdirSync(join(other, 'world', 'region'), { recursive: true })
  mkdirSync(join(other, 'world', 'datapacks'), { recursive: true })
  writeFileSync(join(other, 'world', 'region', 'r.0.0.mca'), 'creative chunks')
  writeFileSync(join(other, 'world', 'datapacks', 'theirs.zip'), 'theirs')
  writeFileSync(join(other, 'server.properties'), 'motd=Creative\n')
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
  return { world, dir, calls, sent, snapshots, replies, propsPath }
}

describe('pre-generation', () => {
  it('says why it cannot run', async () => {
    expect(
      (await (await setup({ loader: 'vanilla' })).world.pregenStatus('survival')).blocked,
    ).toBe('vanilla')
    expect((await (await setup({ chunky: false })).world.pregenStatus('survival')).blocked).toBe(
      'no-chunky',
    )
    const stopped = await setup({ running: false })
    expect((await stopped.world.pregenStatus('survival')).blocked).toBe('stopped')
    await expect(stopped.world.pregen('survival', 'pause')).rejects.toThrow('Start the server')
  })

  it('reports progress, and refuses to start a dimension already running', async () => {
    const { world } = await setup()
    expect(await world.pregenStatus('survival')).toEqual({
      blocked: null,
      tasks: [{ world: 'minecraft:overworld', chunks: 10, percent: 1, eta: '0:10:00', rate: 5 }],
    })
    await expect(
      world.startPregen('survival', {
        dimension: 'overworld',
        radius: 1000,
        center: null,
        shape: 'square',
      }),
    ).rejects.toThrow('already being generated')
  })

  it('starts, confirming when Chunky asks, and cancels', async () => {
    const { world, sent } = await setup()
    await world.startPregen('survival', {
      dimension: 'the_nether',
      radius: 1000,
      center: { x: 0, z: 0 },
      shape: 'circle',
    })
    expect(sent.slice(1)).toEqual([
      'chunky world minecraft:the_nether',
      'chunky center 0 0',
      'chunky radius 1000',
      'chunky shape circle',
      'chunky start',
      'chunky confirm',
    ])
    sent.length = 0
    expect(await world.pregen('survival', 'cancel')).toBe('Done.')
    expect(sent.slice(1)).toEqual(['chunky cancel', 'chunky confirm'])
  })
})

describe('world reset', () => {
  it('backs up, clears the world but keeps datapacks, sets a new seed and restarts', async () => {
    const { world, dir, calls, snapshots, propsPath } = await setup()
    const { done } = world.reset('survival', { random: true })
    expect(await done).toMatchObject({ state: 'succeeded' })
    expect(snapshots).toEqual(['Before resetting the world'])
    expect(existsSync(join(dir, 'world', 'region'))).toBe(false)
    expect(existsSync(join(dir, 'world', 'level.dat'))).toBe(false)
    expect(readFileSync(join(dir, 'world', 'datapacks', 'graves.zip'), 'utf8')).toBe('pack')
    expect(existsSync(join(dir, '.flytower-old-world'))).toBe(false)
    expect(readFileSync(propsPath, 'utf8')).toContain('level-seed=\n')
    expect(calls).toContain('service.stop')
    expect(calls.at(-2)).toBe('service.start')
  })

  it('keeps or sets the seed, and leaves a stopped server stopped', async () => {
    const kept = await setup({ running: false })
    expect(await kept.world.reset('survival', { keep: true }).done).toMatchObject({
      state: 'succeeded',
    })
    expect(readFileSync(kept.propsPath, 'utf8')).toContain('level-seed=123')
    expect(kept.calls).not.toContain('service.start')

    const given = await setup()
    await given.world.reset('survival', { seed: 'theatre' }).done
    expect(readFileSync(given.propsPath, 'utf8')).toContain('level-seed=theatre')
  })
})

describe('copying a world in', () => {
  it("replaces the world, keeps this server's datapacks, and restarts it", async () => {
    const { world, dir, calls, snapshots } = await setup()
    expect(await world.copyWorld('survival', 'creative').done).toMatchObject({
      state: 'succeeded',
    })
    expect(readFileSync(join(dir, 'world', 'region', 'r.0.0.mca'), 'utf8')).toBe('creative chunks')
    expect(existsSync(join(dir, 'world', 'level.dat'))).toBe(false)
    expect(readFileSync(join(dir, 'world', 'datapacks', 'graves.zip'), 'utf8')).toBe('pack')
    expect(existsSync(join(dir, 'world', 'datapacks', 'theirs.zip'))).toBe(false)
    expect(existsSync(join(dir, '.flytower-incoming-world'))).toBe(false)
    expect(existsSync(join(dir, '.flytower-old-world'))).toBe(false)
    expect(snapshots).toEqual(["Before copying in creative's world"])
    expect(calls).toContain('service.stop')
    expect(calls.at(-2)).toBe('service.start')
  })

  it('refuses copying a server into itself', async () => {
    const { world } = await setup()
    expect(() => world.copyWorld('survival', 'survival')).toThrow("can't copy its own world")
  })
})
