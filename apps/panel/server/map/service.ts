/**
 * The web map: whether a server can have one, and keeping squaremap's config in line with
 * the map settings. All folder access goes through here, so it can become agent verbs for
 * other machines later (#29).
 */
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { readMapSettings } from '../../shared/map-settings'
import { schema, type Db } from '../db'
import { JobError, type AgentCall } from '../jobs/runner'
import { readLock } from '../spec/lock'
import { dataDir, hasSquaremap, squaremapConfig, webDir, type MapLoader } from './squaremap'

export class MapError extends JobError {}

export type MapDimension = 'overworld' | 'the_nether' | 'the_end'
export type RenderAction = 'full' | 'cancel'

/** squaremap's replies, without MiniMessage tags or § codes. */
export const plainReply = (reply: string) =>
  reply
    .replace(/<[^<>]*>/g, '')
    .replace(/§./g, '')
    .trim()

export interface MapDeps {
  db: Db
  serverDir: (name: string) => string
  agent: AgentCall
  rcon: (name: string, command: string) => Promise<string>
  cores?: () => number
}

export interface MapStatus {
  /** Why this server can't have a map yet, if it can't. */
  blocked: 'loader' | 'not-installed' | null
  /** squaremap has written its web files, so there's something to show. */
  ready: boolean
}

export class MapService {
  constructor(private deps: MapDeps) {}

  private row(name: string) {
    return this.deps.db.select().from(schema.servers).where(eq(schema.servers.name, name)).get()
  }

  async status(name: string): Promise<MapStatus> {
    const row = this.row(name)
    const loader = (row?.loader ?? 'vanilla') as MapLoader
    const web = webDir(loader)
    if (!row || !web) return { blocked: 'loader', ready: false }
    const dir = this.deps.serverDir(name)
    if (!hasSquaremap((await readLock(dir)).content)) {
      return { blocked: 'not-installed', ready: false }
    }
    const ready = !!(await stat(join(dir, web, 'index.html')).catch(() => null))
    return { blocked: null, ready }
  }

  /**
   * Writes squaremap's config to match the map settings, if squaremap is installed. When the
   * server is running and something changed, squaremap reloads it; otherwise it's read on
   * the next start. Never throws: a map setting must not fail a spec apply.
   */
  async sync(name: string): Promise<void> {
    try {
      await this.syncOrThrow(name)
    } catch (err) {
      console.error(`[flytower] updating ${name}'s map settings failed`, err)
    }
  }

  private async syncOrThrow(name: string) {
    const row = this.row(name)
    const data = row && dataDir(row.loader as MapLoader)
    if (!row || !data) return
    const dir = this.deps.serverDir(name)
    if (!hasSquaremap((await readLock(dir)).content)) return
    const folder = join(dir, data)
    const file = join(folder, 'config.yml')
    const existing = await readFile(file, 'utf8').catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null
      throw err
    })
    const next = squaremapConfig(existing, {
      map: readMapSettings(row.map),
      cores: (this.deps.cores ?? availableParallelism)(),
    })
    if (next === null) return
    // Group-writable, like the rest of the server folder, so squaremap can save it too.
    await mkdir(folder, { recursive: true, mode: 0o770 })
    await writeFile(`${file}.flytower`, next)
    await chmod(`${file}.flytower`, 0o660)
    await rename(`${file}.flytower`, file)
    if (existing === null) return
    const { active } = await this.deps.agent('service.status', { server: name })
    if (active === 'active') await this.deps.rcon(name, 'squaremap reload')
  }

  /**
   * Starts drawing every explored part of a dimension, or stops a drawing under way. squaremap
   * logs its progress to the console. Returns what squaremap said.
   */
  async render(name: string, action: RenderAction, dimension: MapDimension): Promise<string> {
    const s = await this.status(name)
    if (s.blocked === 'loader') throw new MapError('The web map needs a Fabric or Paper server.')
    if (s.blocked === 'not-installed') throw new MapError('Add squaremap to this server first.')
    const { active } = await this.deps.agent('service.status', { server: name })
    if (active !== 'active') throw new MapError('Start the server first.')
    const verb = action === 'full' ? 'fullrender' : 'cancelrender'
    const reply = plainReply(await this.deps.rcon(name, `squaremap ${verb} minecraft:${dimension}`))
    return reply || (action === 'full' ? 'Started drawing the map.' : 'Stopped drawing.')
  }

  /**
   * Deletes the drawn tiles, for a world that's been replaced, so the map doesn't show the old
   * one. squaremap draws the new world as it's explored. Call with the server stopped.
   */
  async clearTiles(name: string): Promise<void> {
    const row = this.row(name)
    const web = row && webDir(row.loader as MapLoader)
    if (!web) return
    await rm(join(this.deps.serverDir(name), web, 'tiles'), { recursive: true, force: true })
  }

  /** At boot: every server's map config, in case it was changed by hand or by a restore. */
  async syncAll(): Promise<void> {
    const rows = this.deps.db.select({ name: schema.servers.name }).from(schema.servers).all()
    for (const { name } of rows) await this.sync(name)
  }
}
