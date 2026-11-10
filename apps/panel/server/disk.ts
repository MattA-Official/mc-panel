/**
 * Where the disk has gone. Walks each server's folder, its backups and its world exports,
 * plus the imports and archive folders, and adds up what's in them. A walk can take a while
 * on a big world, so it runs in the background, one folder at a time: after any job that
 * changes what's on disk (a backup, a restore, an import, a world reset) and once an hour
 * as a catch-all. Pages read the last result, which is kept in the settings table so it
 * survives a panel restart.
 *
 * Symlinks are never followed, and folders the panel can't read are counted as unreadable
 * rather than failing the walk. Sizes are the space files take on disk (allocated blocks),
 * so sparse region files count for what they really use.
 *
 * The agent does the measuring (`disk.usage`), as root, so every folder can be read and the
 * rest of the machine can be split into parts too (Java, Flytower, logs, caches). It's also
 * the one place disk use is measured, so it carries over when Flytower runs several boxes.
 * When the agent can't (an older agent, or it fails), the panel walks the server folders
 * itself, as before, and the rest of the machine stays one slice.
 *
 * The panel's own walking is done by `flytower-du` (crates/flytower-du), a Rust program shipped
 * next to Bun in each release, which gives the same numbers many times faster. When it isn't
 * there (development) or fails, the TypeScript walk below does the job instead.
 */
import { existsSync } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Result } from '@flytower/protocol'
import { LOCAL_MACHINE, type DiskGroup, type DiskReport, type ServerDisk } from '../shared/disk'

export { DISK_GROUPS, type DiskGroup, type DiskReport, type ServerDisk } from '../shared/disk'

/** Which group a top-level entry of a server folder belongs to. */
export function groupOf(
  entry: string,
  levelName: string | null,
): Exclude<DiskGroup, 'backups' | 'exports'> {
  const level = levelName?.split('/')[0]?.trim()
  if ((level && entry === level) || entry.startsWith('world')) return 'world'
  if (entry === 'logs' || entry === 'crash-reports') return 'logs'
  if (entry === 'mods' || entry === 'plugins' || entry === 'config') return 'content'
  return 'other'
}

export interface Measured {
  bytes: number
  /** Folders and files that couldn't be read, so the total is a floor. */
  unreadable: number
}

const onDisk = (s: { blocks?: number; size: number }) =>
  typeof s.blocks === 'number' && s.blocks >= 0 ? s.blocks * 512 : s.size

/**
 * Bytes under `path` (a file or a folder), never following symlinks. Hard links are counted
 * once. A missing path is zero.
 */
export async function measure(path: string, seen = new Set<string>()): Promise<Measured> {
  const out: Measured = { bytes: 0, unreadable: 0 }
  const add = (s: { dev: number; ino: number; nlink: number; blocks?: number; size: number }) => {
    if (s.nlink > 1) {
      const id = `${s.dev}:${s.ino}`
      if (seen.has(id)) return
      seen.add(id)
    }
    out.bytes += onDisk(s)
  }
  const walk = async (p: string) => {
    let s
    try {
      s = await lstat(p)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') out.unreadable++
      return
    }
    if (s.isSymbolicLink()) return
    if (!s.isDirectory()) return add(s)
    out.bytes += onDisk(s)
    let names: string[]
    try {
      names = await readdir(p)
    } catch {
      out.unreadable++
      return
    }
    for (const name of names) await walk(join(p, name))
  }
  await walk(path)
  return out
}

/** Measures each path in turn, counting a hard-linked file once across all of them. */
export type MeasureMany = (paths: string[]) => Promise<Measured[]>

/** The TypeScript walk, one path after another. */
export const measureInTs: MeasureMany = async (paths) => {
  const seen = new Set<string>()
  const out: Measured[] = []
  for (const path of paths) out.push(await measure(path, seen))
  return out
}

/** Where the Rust walker is: next to Bun in the release's bin/, or wherever FLYTOWER_DU says. */
export const duBinary = () =>
  process.env.FLYTOWER_DU || join(dirname(process.execPath), 'flytower-du')

/** The Rust walker. Throws if it fails or answers in a way this panel doesn't understand. */
export function measureWithBinary(bin: string): MeasureMany {
  return async (paths) => {
    const proc = Bun.spawn([bin, '--', ...paths], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (code !== 0) throw new Error(`flytower-du exited with ${code}: ${err.trim()}`)
    const parsed = JSON.parse(out) as { version?: unknown; results?: Measured[] }
    if (parsed.version !== 1 || parsed.results?.length !== paths.length) {
      throw new Error("flytower-du's answer isn't one this panel understands")
    }
    return parsed.results
  }
}

let warned = false

/** Measures with the Rust walker when it's there, and the TypeScript walk otherwise. */
export async function measureMany(paths: string[], bin = duBinary()): Promise<Measured[]> {
  if (paths.length === 0) return []
  if (existsSync(bin)) {
    try {
      return await measureWithBinary(bin)(paths)
    } catch (err) {
      if (!warned) console.error('[flytower] flytower-du failed; measuring the slower way', err)
      warned = true
    }
  }
  return measureInTs(paths)
}

export interface DiskDeps {
  /** Every server's name. */
  names: () => string[]
  serverDir: (name: string) => string
  backupsDir: string
  exportsDir: string
  /** Where web maps live; each server's map counts towards it. */
  mapsDir?: string
  importsDir: string
  archiveDir: string
  /** The server's `level-name`, from server.properties. */
  levelName: (name: string) => Promise<string | null>
  load?: () => DiskReport | null
  save?: (report: DiskReport) => void
  now?: () => Date
  /** How to walk; `measureMany` unless a test says otherwise. */
  measure?: MeasureMany
  /** Asks the agent to measure (`disk.usage`). Without it, or when it fails, the panel walks. */
  agent?: (servers: string[], system: boolean) => Promise<Result<'disk.usage'>>
}

/** Measures one server: its folder by group, plus its backups and exports. */
export async function measureServer(
  deps: Pick<
    DiskDeps,
    'serverDir' | 'backupsDir' | 'exportsDir' | 'mapsDir' | 'levelName' | 'measure'
  >,
  server: string,
  at: Date,
): Promise<ServerDisk> {
  const groups: Record<DiskGroup, number> = {
    world: 0,
    backups: 0,
    exports: 0,
    logs: 0,
    content: 0,
    map: 0,
    other: 0,
  }
  let unreadable = 0
  const dir = deps.serverDir(server)
  const level = await deps.levelName(server).catch(() => null)
  let entries: string[] = []
  try {
    entries = await readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') unreadable++
  }
  // One walk for everything, so a file hard-linked into a backup is counted once.
  const labelled: [DiskGroup, string][] = [
    ...entries.map((e): [DiskGroup, string] => [groupOf(e, level), join(dir, e)]),
    ['backups', join(deps.backupsDir, server)],
    ['exports', join(deps.exportsDir, server)],
    ...(deps.mapsDir
      ? [['map', join(deps.mapsDir, 'servers', server)] as [DiskGroup, string]]
      : []),
  ]
  const results = await (deps.measure ?? measureMany)(labelled.map(([, path]) => path))
  labelled.forEach(([group], i) => {
    groups[group] += results[i]!.bytes
    unreadable += results[i]!.unreadable
  })
  const bytes = Object.values(groups).reduce((a, b) => a + b, 0)
  return { server, bytes, groups, unreadable, measuredAt: at.toISOString() }
}

/** A server's figures as the agent sent them. */
export function fromAgent(
  server: string,
  measured: Result<'disk.usage'>['servers'][string],
  at: Date,
): ServerDisk {
  const groups = { ...measured.groups }
  const bytes = Object.values(groups).reduce((a, b) => a + b, 0)
  return { server, bytes, groups, unreadable: measured.unreadable, measuredAt: at.toISOString() }
}

/** The group with the most in it, for the System table. */
export function largestGroup(s: Pick<ServerDisk, 'groups'>): DiskGroup | null {
  let best: DiskGroup | null = null
  for (const [g, n] of Object.entries(s.groups) as [DiskGroup, number][]) {
    if (n > 0 && (best === null || n > s.groups[best])) best = g
  }
  return best
}

/** Keeps the latest measurement of every server, refreshing in the background. */
export class DiskUsage {
  private report: DiskReport
  private now: () => Date
  /** Servers waiting to be measured; `*` is the shared folders. */
  private queue = new Set<string>()
  private running: Promise<void> | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private deps: DiskDeps) {
    this.now = deps.now ?? (() => new Date())
    this.report = deps.load?.() ?? { servers: [], shared: null, system: null, measuredAt: null }
    this.report.machine ??= LOCAL_MACHINE
  }

  private warned = false
  /** Runs `fn` through the agent, or returns null so the caller walks instead. */
  private async viaAgent<T>(
    fn: (agent: NonNullable<DiskDeps['agent']>) => Promise<T>,
  ): Promise<T | null> {
    if (!this.deps.agent) return null
    try {
      return await fn(this.deps.agent)
    } catch (err) {
      if (!this.warned) {
        console.error("[flytower] the agent couldn't measure disk use; walking instead", err)
      }
      this.warned = true
      return null
    }
  }

  /** The last measurement, limited to servers that still exist. */
  current(): DiskReport & { measuring: boolean } {
    const names = new Set(this.deps.names())
    return {
      ...this.report,
      servers: this.report.servers.filter((s) => names.has(s.server)),
      measuring: this.running !== null,
    }
  }

  server(name: string): ServerDisk | null {
    return this.report.servers.find((s) => s.server === name) ?? null
  }

  /** Measures everything now and every hour. */
  start(everyMs = 3600_000) {
    if (this.timer) return
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), everyMs)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * Queues a server (or, with none, every server and the shared folders) for measuring and
   * resolves once the queue is empty. Asking again while it runs just adds to the queue.
   */
  refresh(server?: string | null): Promise<void> {
    if (server) this.queue.add(server)
    else for (const name of ['*', ...this.deps.names()]) this.queue.add(name)
    this.running ??= this.drain().finally(() => {
      this.running = null
    })
    return this.running
  }

  /** Drops a deleted server, and re-measures the archive it went to. */
  forget(server: string) {
    this.queue.delete(server)
    this.report = {
      ...this.report,
      servers: this.report.servers.filter((s) => s.server !== server),
    }
    this.persist()
    void this.refresh('*')
  }

  private async drain() {
    while (this.queue.size) {
      const [next] = this.queue
      this.queue.delete(next!)
      try {
        if (next === '*') await this.measureShared()
        else if (this.deps.names().includes(next!)) await this.measureOne(next!)
      } catch (err) {
        console.error(`[flytower] measuring disk use for ${next} failed`, err)
      }
    }
  }

  private async measureOne(server: string) {
    const at = this.now()
    const s =
      (await this.viaAgent(async (agent) => {
        const measured = (await agent([server], false)).servers[server]
        if (!measured) throw new Error(`no figures for ${server}`)
        return fromAgent(server, measured, at)
      })) ?? (await measureServer(this.deps, server, at))
    const others = this.report.servers.filter((r) => r.server !== server)
    this.report = {
      ...this.report,
      servers: [...others, s].sort((a, b) => a.server.localeCompare(b.server)),
      measuredAt: s.measuredAt,
    }
    this.persist()
  }

  private async measureShared() {
    const measured = await this.viaAgent((agent) => agent([], true))
    if (measured?.shared) {
      this.report = {
        ...this.report,
        shared: measured.shared,
        system: measured.system,
        measuredAt: this.now().toISOString(),
      }
      this.persist()
      return
    }
    const walk = this.deps.measure ?? measureMany
    const [[imports], [archive]] = (await Promise.all([
      walk([this.deps.importsDir]),
      walk([this.deps.archiveDir]),
    ])) as [[Measured], [Measured]]
    const at = this.now().toISOString()
    this.report = {
      ...this.report,
      shared: {
        imports: imports.bytes,
        archive: archive.bytes,
        unreadable: imports.unreadable + archive.unreadable,
      },
      system: null,
      measuredAt: at,
    }
    this.persist()
  }

  private persist() {
    try {
      this.deps.save?.(this.report)
    } catch (err) {
      console.error('[flytower] saving disk use failed', err)
    }
  }
}
