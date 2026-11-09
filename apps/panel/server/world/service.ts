/**
 * The world: pre-generating it with Chunky, and resetting it. All folder access goes
 * through here, so it can become agent verbs for other machines later (#29).
 */
import { readdir, rename, rm, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { WORLD_COPY_STEPS, WORLD_RESET_STEPS, type JobEvent } from '../../shared/utils/jobs'
import { folderBytes } from '../backups/service'
import { copyFolder } from '../clone'
import { schema, type Db } from '../db'
import { JobError, type AgentCall, type JobTracker } from '../jobs/runner'
import type { BackupService } from '../backups/service'
import { readLock } from '../spec/lock'
import { levelNameOf } from '../spec/apply'
import {
  needsConfirm,
  parseProgress,
  startCommands,
  type ChunkyTask,
  type PregenOptions,
} from './chunky'

export class WorldError extends JobError {}

export interface WorldDeps {
  db: Db
  serverDir: (name: string) => string
  agent: AgentCall
  jobs: {
    track(kind: string, server: string | null, steps: readonly string[]): JobTracker
    waitActive(name: string): Promise<void>
  }
  backups: Pick<BackupService, 'lock' | 'snapshot' | 'withSavesPaused' | 'ensureSpace'>
  rcon: (name: string, command: string, timeoutMs?: number) => Promise<string>
  readProperties: (name: string) => Promise<Record<string, string>>
  writeProperties: (name: string, changes: Record<string, string>) => Promise<void>
  stopped?: (name: string) => void
  sleep?: (ms: number) => Promise<void>
}

export interface PregenStatus {
  /** Why pre-generation can't run here, if it can't. */
  blocked: 'loader' | 'no-chunky' | 'stopped' | null
  tasks: ChunkyTask[]
}

export type PregenAction = 'pause' | 'continue' | 'cancel'

/** keep: the same seed; random: a new one; anything else: that seed. */
export type SeedChoice = { keep: true } | { random: true } | { seed: string }

export class WorldService {
  private sleep: (ms: number) => Promise<void>

  constructor(private deps: WorldDeps) {
    this.sleep = deps.sleep ?? ((ms) => Bun.sleep(ms))
  }

  private row(name: string) {
    const row = this.deps.db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.name, name))
      .get()
    if (!row) throw new WorldError(`No server called ${name}.`)
    return row
  }

  private async isRunning(name: string) {
    const { active } = await this.deps.agent('service.status', { server: name })
    return active === 'active'
  }

  /** Whether Chunky can run, and what it's doing. */
  async pregenStatus(name: string): Promise<PregenStatus> {
    const row = this.row(name)
    if (row.loader === 'vanilla') return { blocked: 'loader', tasks: [] }
    const lock = await readLock(this.deps.serverDir(name))
    if (!lock.content.some((l) => l.source === 'modrinth' && l.slug === 'chunky')) {
      return { blocked: 'no-chunky', tasks: [] }
    }
    if (!(await this.isRunning(name))) return { blocked: 'stopped', tasks: [] }
    const reply = await this.deps.rcon(name, 'chunky progress')
    return { blocked: null, tasks: parseProgress(reply) }
  }

  private async ready(name: string) {
    const s = await this.pregenStatus(name)
    if (s.blocked === 'loader') {
      throw new WorldError(
        'Pre-generation needs a Fabric or Paper server. Change the loader in Settings.',
      )
    }
    if (s.blocked === 'no-chunky') throw new WorldError('Add Chunky to this server first.')
    if (s.blocked === 'stopped') throw new WorldError('Start the server first.')
    return s
  }

  /** Runs a Chunky command, confirming if it asks. Returns what Chunky said. */
  private async chunky(name: string, command: string) {
    let reply = await this.deps.rcon(name, command)
    if (needsConfirm(reply)) reply = await this.deps.rcon(name, 'chunky confirm')
    return reply.trim()
  }

  async startPregen(name: string, o: PregenOptions): Promise<string> {
    const s = await this.ready(name)
    if (s.tasks.some((t) => t.world === `minecraft:${o.dimension}` && t.percent < 100)) {
      throw new WorldError('That dimension is already being generated. Pause or cancel it first.')
    }
    let reply = ''
    for (const c of startCommands(o)) reply = await this.chunky(name, c)
    return reply
  }

  async pregen(name: string, action: PregenAction): Promise<string> {
    await this.ready(name)
    return this.chunky(name, `chunky ${action}`)
  }

  /** Starts a world reset job. The caller has already checked a passkey. */
  reset(name: string, seed: SeedChoice): { jobId: number; done: Promise<JobEvent> } {
    this.row(name)
    if ('seed' in seed && (!seed.seed.trim() || seed.seed.length > 64)) {
      throw new WorldError('A seed is 1 to 64 characters.')
    }
    const release = this.deps.backups.lock(name)
    const job = this.deps.jobs.track('world.reset', name, WORLD_RESET_STEPS)
    const done = this.runReset(name, seed, job)
      .then(() => job.succeed('The world was reset. The old one is in Backups.'))
      .catch((err) => job.fail(err))
      .finally(release)
    return { jobId: job.id, done }
  }

  private async stop(name: string) {
    await this.deps.agent('service.stop', { server: name }, { timeoutMs: 180_000 })
    for (let i = 0; i < 180; i++) {
      const { active } = await this.deps.agent('service.status', { server: name })
      if (active === 'inactive' || active === 'failed') {
        this.deps.stopped?.(name)
        return
      }
      await this.sleep(1000)
    }
    throw new WorldError('The server took too long to stop.')
  }

  private async runReset(name: string, seed: SeedChoice, job: JobTracker) {
    const dir = this.deps.serverDir(name)
    const props = await this.deps.readProperties(name)
    const level = levelNameOf(props)
    const wasRunning = await this.isRunning(name)

    job.step(0, 'A copy of the world as it is now')
    await this.deps.backups.snapshot(name, 'Before resetting the world')

    if (wasRunning) {
      job.step(1)
      await this.stop(name)
    }

    job.step(2)
    await this.deps.agent('server.permissions', { name }, { timeoutMs: 120_000 })
    const world = join(dir, level)
    const old = join(dir, `.flytower-old-world`)
    await rm(old, { recursive: true, force: true })
    if (await stat(world).catch(() => null)) {
      await rename(world, old)
      // Datapacks are installed content (and in the lockfile), not part of the world.
      await mkdir(world, { recursive: true })
      const packs = join(old, 'datapacks')
      if ((await readdir(packs).catch(() => null)) !== null) {
        await rename(packs, join(world, 'datapacks'))
      }
      await rm(old, { recursive: true, force: true })
    }

    job.step(3)
    if ('random' in seed) await this.deps.writeProperties(name, { 'level-seed': '' })
    else if ('seed' in seed) await this.deps.writeProperties(name, { 'level-seed': seed.seed })

    if (wasRunning) {
      job.step(4, 'Generating the new world')
      await this.deps.agent('service.start', { server: name })
      await this.deps.jobs.waitActive(name)
    }
  }

  /**
   * Starts a job copying `from`'s world over `name`'s. The caller has already checked a
   * passkey. The target's datapacks stay, since they're its installed content.
   */
  copyWorld(name: string, from: string): { jobId: number; done: Promise<JobEvent> } {
    if (name === from) throw new WorldError("A server can't copy its own world.")
    this.row(name)
    const source = this.row(from)
    const releaseTarget = this.deps.backups.lock(name)
    let releaseSource: () => void
    try {
      releaseSource = this.deps.backups.lock(from)
    } catch (err) {
      releaseTarget()
      throw err
    }
    const job = this.deps.jobs.track('world.copy', name, WORLD_COPY_STEPS)
    const done = this.runCopy(name, from, job)
      .then(() => job.succeed(`Copied ${source.displayName}'s world. The old one is in Backups.`))
      .catch((err) => job.fail(err))
      .finally(() => {
        releaseSource()
        releaseTarget()
      })
    return { jobId: job.id, done }
  }

  private async runCopy(name: string, from: string, job: JobTracker) {
    const dir = this.deps.serverDir(name)
    const level = levelNameOf(await this.deps.readProperties(name))
    const fromLevel = levelNameOf(await this.deps.readProperties(from))
    const fromWorld = join(this.deps.serverDir(from), fromLevel)
    if (!(await stat(fromWorld).catch(() => null))?.isDirectory()) {
      throw new WorldError(`${from} has no world to copy yet. Start it once first.`)
    }
    const incoming = join(dir, '.flytower-incoming-world')
    const old = join(dir, '.flytower-old-world')
    await rm(incoming, { recursive: true, force: true })
    await rm(old, { recursive: true, force: true })

    job.step(0, `From ${from}`)
    try {
      await this.deps.backups.ensureSpace(dir, await folderBytes(fromWorld))
      await this.deps.backups.withSavesPaused(
        from,
        () => {},
        () => copyFolder(fromWorld, incoming),
      )
    } catch (err) {
      await rm(incoming, { recursive: true, force: true })
      throw err
    }

    job.step(1, 'A copy of the world as it is now')
    await this.deps.backups.snapshot(name, `Before copying in ${from}'s world`)

    const wasRunning = await this.isRunning(name)
    if (wasRunning) {
      job.step(2)
      await this.stop(name)
    }

    job.step(3)
    await this.deps.agent('server.permissions', { name }, { timeoutMs: 120_000 })
    const world = join(dir, level)
    const hadWorld = !!(await stat(world).catch(() => null))
    try {
      // The incoming world brings its own datapacks; this server keeps its own.
      await rm(join(incoming, 'datapacks'), { recursive: true, force: true })
      if (hadWorld) {
        await rename(world, old)
        if ((await readdir(join(old, 'datapacks')).catch(() => null)) !== null) {
          await rename(join(old, 'datapacks'), join(incoming, 'datapacks'))
        }
      }
      await rename(incoming, world)
    } catch (err) {
      // Put the old world back as it was.
      if (hadWorld && (await stat(old).catch(() => null))) {
        if (await stat(join(incoming, 'datapacks')).catch(() => null)) {
          await rename(join(incoming, 'datapacks'), join(old, 'datapacks')).catch(() => {})
        }
        await rm(world, { recursive: true, force: true }).catch(() => {})
        await rename(old, world).catch(() => {})
      }
      await rm(incoming, { recursive: true, force: true })
      if (wasRunning) await this.deps.agent('service.start', { server: name }).catch(() => {})
      throw err
    }
    await rm(old, { recursive: true, force: true })

    if (wasRunning) {
      job.step(4)
      await this.deps.agent('service.start', { server: name })
      await this.deps.jobs.waitActive(name)
    }
  }
}
