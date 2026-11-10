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
 */
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { DiskGroup, DiskReport, ServerDisk } from '../shared/disk'

export { DISK_GROUPS, type DiskGroup, type DiskReport, type ServerDisk } from '../shared/disk'

/** Which group a top-level entry of a server folder belongs to. */
export function groupOf(entry: string, levelName: string | null): Exclude<
  DiskGroup,
  'backups' | 'exports'
> {
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

export interface DiskDeps {
  /** Every server's name. */
  names: () => string[]
  serverDir: (name: string) => string
  backupsDir: string
  exportsDir: string
  importsDir: string
  archiveDir: string
  /** The server's `level-name`, from server.properties. */
  levelName: (name: string) => Promise<string | null>
  load?: () => DiskReport | null
  save?: (report: DiskReport) => void
  now?: () => Date
}

/** Measures one server: its folder by group, plus its backups and exports. */
export async function measureServer(
  deps: Pick<DiskDeps, 'serverDir' | 'backupsDir' | 'exportsDir' | 'levelName'>,
  server: string,
  at: Date,
): Promise<ServerDisk> {
  const groups: Record<DiskGroup, number> = {
    world: 0,
    backups: 0,
    exports: 0,
    logs: 0,
    content: 0,
    other: 0,
  }
  let unreadable = 0
  const dir = deps.serverDir(server)
  const level = await deps.levelName(server).catch(() => null)
  const seen = new Set<string>()
  let entries: string[] = []
  try {
    entries = await readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') unreadable++
  }
  for (const entry of entries) {
    const m = await measure(join(dir, entry), seen)
    groups[groupOf(entry, level)] += m.bytes
    unreadable += m.unreadable
  }
  for (const [group, root] of [
    ['backups', deps.backupsDir],
    ['exports', deps.exportsDir],
  ] as const) {
    const m = await measure(join(root, server), seen)
    groups[group] += m.bytes
    unreadable += m.unreadable
  }
  const bytes = Object.values(groups).reduce((a, b) => a + b, 0)
  return { server, bytes, groups, unreadable, measuredAt: at.toISOString() }
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
    this.report = deps.load?.() ?? { servers: [], shared: null, measuredAt: null }
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
    const s = await measureServer(this.deps, server, this.now())
    const others = this.report.servers.filter((r) => r.server !== server)
    this.report = {
      ...this.report,
      servers: [...others, s].sort((a, b) => a.server.localeCompare(b.server)),
      measuredAt: s.measuredAt,
    }
    this.persist()
  }

  private async measureShared() {
    const [imports, archive] = await Promise.all([
      measure(this.deps.importsDir),
      measure(this.deps.archiveDir),
    ])
    const at = this.now().toISOString()
    this.report = {
      ...this.report,
      shared: {
        imports: imports.bytes,
        archive: archive.bytes,
        unreadable: imports.unreadable + archive.unreadable,
      },
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
