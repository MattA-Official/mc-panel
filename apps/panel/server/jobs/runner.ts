import { chmod, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { ServerName, type Params, type Result, type Verb } from '@flytower/protocol'
import {
  downloadVerified,
  ProviderError,
  type Fetch,
  type LoaderId,
  type LoaderProvider,
} from '@flytower/providers'
import { schema, type Db } from '../db'
import { Bus } from './bus'
import { defaultProperties, EULA, randomPassword } from './properties'

export type AgentCall = <V extends Verb>(
  verb: V,
  params: Params<V>,
  opts?: { timeoutMs?: number },
) => Promise<Result<V>>

export const CreateServerInput = z.object({
  name: ServerName,
  displayName: z.string().trim().min(1).max(60),
  loader: z.enum(['vanilla', 'fabric']),
  mcVersion: z.string().min(1).max(40),
  loaderVersion: z.string().min(1).max(40).default('latest-stable'),
  memoryMb: z.number().int().min(1024).max(65536),
  port: z.number().int().min(1024).max(65535).optional(),
  acceptEula: z.literal(true, { error: 'You need to accept the Minecraft EULA.' }),
})
export type CreateServerInput = z.input<typeof CreateServerInput>

export interface JobEvent {
  id: number
  state: 'queued' | 'running' | 'succeeded' | 'failed'
  step: string | null
  progress: number
  message: string | null
}

export interface RunnerDeps {
  db: Db
  agent: AgentCall
  loaders: Record<LoaderId, LoaderProvider>
  fetch: Fetch
  bus?: Bus
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  /** How long to wait for systemd to report the server active. */
  startTimeoutMs?: number
}

export const STEPS = [
  'Checking the details',
  'Finding the download',
  'Installing Java',
  'Creating the server',
  'Downloading Minecraft',
  'Writing the config',
  'Starting the server',
] as const

const GAME_PORT_BASE = 25565
const RCON_PORT_BASE = 25575

export class JobError extends Error {
  override name = 'JobError'
}

/** Picks the lowest port at or above `base` that nothing else uses. */
export function lowestFree(base: number, used: Set<number>): number {
  let p = base
  while (used.has(p)) p++
  if (p > 65535) throw new JobError('No free ports left.')
  return p
}

/**
 * Runs long operations as jobs: each step is written to the `jobs` table and published on
 * the bus as `job:<id>`, so a browser can follow live or reload and catch up.
 */
export class JobRunner {
  readonly bus: Bus
  private readonly now: () => Date
  private readonly sleep: (ms: number) => Promise<void>
  /** Names and ports held by jobs still running, so two wizards can't race for them. */
  private reservedNames = new Set<string>()
  private reservedPorts = new Set<number>()

  constructor(private deps: RunnerDeps) {
    this.bus = deps.bus ?? new Bus()
    this.now = deps.now ?? (() => new Date())
    this.sleep = deps.sleep ?? ((ms) => Bun.sleep(ms))
  }

  /** At boot nothing can be running, so anything left `queued` or `running` was cut off. */
  recover(): number {
    const cut = this.deps.db
      .update(schema.jobs)
      .set({
        state: 'failed',
        message: 'The panel restarted during this job. Check the server and try again.',
        finishedAt: this.now(),
      })
      .where(inArray(schema.jobs.state, ['queued', 'running']))
      .returning({ id: schema.jobs.id })
      .all()
    return cut.length
  }

  get(id: number): JobEvent | null {
    const row = this.deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get()
    return row ? toEvent(row) : null
  }

  /**
   * Validates synchronously enough to refuse obvious mistakes with a 400, then returns the
   * job id while the work carries on in the background. `done` resolves when it finishes.
   */
  createServer(raw: CreateServerInput): { jobId: number; done: Promise<JobEvent> } {
    const input = CreateServerInput.parse(raw)
    const { port, rconPort } = this.claim(input.name, input.port)
    const job = this.deps.db
      .insert(schema.jobs)
      .values({ kind: 'server.create', server: input.name, state: 'queued' })
      .returning()
      .get()

    const done = this.execute(job.id, input, port, rconPort).finally(() => {
      this.reservedNames.delete(input.name)
      this.reservedPorts.delete(port)
      this.reservedPorts.delete(rconPort)
    })
    return { jobId: job.id, done }
  }

  private claim(name: string, requested?: number) {
    const rows = this.deps.db
      .select({
        name: schema.servers.name,
        port: schema.servers.port,
        rcon: schema.servers.rconPort,
      })
      .from(schema.servers)
      .all()
    if (rows.some((r) => r.name === name) || this.reservedNames.has(name)) {
      throw new JobError(`There's already a server called ${name}.`)
    }
    const used = new Set([...this.reservedPorts, ...rows.flatMap((r) => [r.port, r.rcon])])
    if (requested !== undefined && used.has(requested)) {
      throw new JobError(`Port ${requested} is already used by another server.`)
    }
    const port = requested ?? lowestFree(GAME_PORT_BASE, used)
    used.add(port)
    const rconPort = lowestFree(RCON_PORT_BASE, used)
    this.reservedNames.add(name)
    this.reservedPorts.add(port).add(rconPort)
    return { port, rconPort }
  }

  private update(id: number, patch: Partial<Omit<JobEvent, 'id'>>): JobEvent {
    const finished = patch.state === 'succeeded' || patch.state === 'failed'
    const row = this.deps.db
      .update(schema.jobs)
      .set({ ...patch, ...(finished ? { finishedAt: this.now() } : {}) })
      .where(eq(schema.jobs.id, id))
      .returning()
      .get()
    const event = toEvent(row!)
    this.bus.publish(`job:${id}`, event)
    return event
  }

  private step(id: number, index: number, message: string | null = null) {
    this.update(id, {
      state: 'running',
      step: STEPS[index]!,
      progress: Math.round((index / STEPS.length) * 100),
      message,
    })
  }

  private async execute(
    id: number,
    input: z.output<typeof CreateServerInput>,
    port: number,
    rconPort: number,
  ): Promise<JobEvent> {
    const { agent, loaders, db } = this.deps
    let created = false
    try {
      this.step(id, 0)
      const loader = loaders[input.loader]

      this.step(id, 1, `${loader.name} ${input.mcVersion}`)
      const resolved = await loader.resolve(input.mcVersion, input.loaderVersion)

      this.step(id, 2, `Java ${resolved.javaMajor}`)
      await agent(
        'runtime.install',
        { vendor: 'temurin', major: resolved.javaMajor },
        { timeoutMs: 10 * 60_000 },
      )

      this.step(id, 3)
      const made = await agent('server.create', {
        name: input.name,
        port,
        memoryMb: input.memoryMb,
        javaMajor: resolved.javaMajor,
      })
      created = true

      this.step(id, 4, resolved.url)
      const part = join(made.directory, 'server.jar.part')
      await downloadVerified(this.deps.fetch, resolved.url, part, resolved.hash)
      await rename(part, join(made.directory, 'server.jar'))

      this.step(id, 5)
      const acceptedAt = this.now()
      const rconPassword = randomPassword()
      // Group-writable, whatever the panel's umask, so the server (same group) can edit them.
      const files: [string, string][] = [
        ['eula.txt', EULA(acceptedAt)],
        [
          'server.properties',
          defaultProperties({ port, rconPort, rconPassword, motd: input.displayName }),
        ],
      ]
      for (const [file, body] of files) {
        await writeFile(join(made.directory, file), body)
        await chmod(join(made.directory, file), 0o660)
      }
      db.insert(schema.servers)
        .values({
          name: input.name,
          displayName: input.displayName,
          loader: input.loader,
          mcVersion: input.mcVersion,
          loaderVersion: resolved.loaderVersion,
          javaMajor: resolved.javaMajor,
          memoryMb: input.memoryMb,
          port,
          rconPort,
          rconPassword,
          eulaAcceptedAt: acceptedAt,
        })
        .run()

      this.step(id, 6)
      await agent('service.start', { server: input.name })
      await this.waitActive(input.name)

      return this.update(id, {
        state: 'succeeded',
        step: 'Done',
        progress: 100,
        message: `${input.displayName} is running on port ${port}.`,
      })
    } catch (err) {
      const message = friendly(err)
      if (created) await this.rollback(input.name, message)
      return this.update(id, { state: 'failed', message })
    }
  }

  private async waitActive(name: string) {
    const deadline = Date.now() + (this.deps.startTimeoutMs ?? 60_000)
    for (;;) {
      const { active } = await this.deps.agent('service.status', { server: name })
      if (active === 'active') return
      if (active === 'failed') throw new JobError('The server failed to start. Check its log.')
      if (Date.now() > deadline) throw new JobError('The server took too long to start.')
      await this.sleep(1000)
    }
  }

  /** Undoes a half-made server so the same name can be tried again. */
  private async rollback(name: string, reason: string) {
    this.deps.db.delete(schema.servers).where(eq(schema.servers.name, name)).run()
    try {
      await this.deps.agent('server.delete', { name })
    } catch (err) {
      console.error(`[flytower] rollback of ${name} after "${reason}" failed`, err)
    }
  }
}

function friendly(err: unknown): string {
  if (err instanceof ProviderError || err instanceof JobError) return err.message
  if (err instanceof Error && err.name === 'AgentError')
    return `The system helper said: ${err.message}`
  console.error('[flytower] job failed', err)
  return err instanceof Error ? err.message : 'Something went wrong.'
}

function toEvent(row: typeof schema.jobs.$inferSelect): JobEvent {
  return {
    id: row.id,
    state: row.state,
    step: row.step,
    progress: row.progress,
    message: row.message,
  }
}
