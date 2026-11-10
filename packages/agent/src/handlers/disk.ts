/**
 * Disk use, measured as root so nothing is out of reach, and three fixed ways to free some.
 * Every place measured is built from the agent's own paths and a fixed list; the panel only
 * names servers. `crates/flytower-agent/src/handlers/disk.rs` does exactly the same.
 */
import { existsSync } from 'node:fs'
import { lstat, readFile, readdir, readlink, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { AgentError, type Params, type Result } from '@flytower/protocol'
import type { AgentContext } from '../context.ts'
import { measurer, type Measured } from '../du.ts'
import { readRecord } from '../updater.ts'
import { busy } from './update.ts'

export type ServerGroup = 'world' | 'logs' | 'content' | 'map' | 'backups' | 'exports' | 'other'

/** Which group a top-level entry of a server folder counts towards. */
export function groupOf(entry: string, levelName: string | null): ServerGroup {
  const level = levelName?.split('/')[0]?.trim()
  if ((level && entry === level) || entry.startsWith('world')) return 'world'
  if (entry === 'logs' || entry === 'crash-reports') return 'logs'
  if (entry === 'mods' || entry === 'plugins' || entry === 'config') return 'content'
  return 'other'
}

/** Every folder the agent measures or cleans, from its paths. */
export function places(ctx: AgentContext) {
  const data = ctx.paths.panelData ?? '/var/lib/flytower'
  const prefix = ctx.paths.prefix ?? '/opt/flytower'
  const root = ctx.paths.system ?? '/'
  return {
    servers: ctx.paths.servers,
    runtimes: ctx.paths.runtimes,
    config: ctx.paths.config,
    prefix,
    data,
    backups: join(data, 'backups'),
    exports: join(data, 'exports'),
    maps: join(data, 'maps'),
    imports: join(data, 'imports'),
    archive: ctx.paths.archive,
    varLog: join(root, 'var/log'),
    journal: join(root, 'var/log/journal'),
    apt: join(root, 'var/cache/apt'),
    tmp: join(root, 'tmp'),
    varTmp: join(root, 'var/tmp'),
  }
}

/** What `apt-get clean` removes. */
const aptCache = (p: ReturnType<typeof places>) => [
  join(p.apt, 'archives'),
  join(p.apt, 'pkgcache.bin'),
  join(p.apt, 'srcpkgcache.bin'),
]

/** A server's `level-name`, or null. */
async function levelName(dir: string): Promise<string | null> {
  const text = await readFile(join(dir, 'server.properties'), 'utf8').catch(() => '')
  for (const line of text.split('\n')) {
    const m = /^\s*level-name\s*[=:]\s*(.*)$/.exec(line)
    if (m) return m[1]!.trim() || null
  }
  return null
}

async function names(dir: string): Promise<{ names: string[]; unreadable: number }> {
  try {
    return { names: (await readdir(dir)).sort(), unreadable: 0 }
  } catch (err) {
    return { names: [], unreadable: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 0 : 1 }
  }
}

/** The device a path is on, or null if it isn't there. */
const deviceOf = (path: string) =>
  lstat(path).then(
    (s) => (s.isSymbolicLink() ? null : s.dev),
    () => null,
  )

/** The release `current` points at, or null. */
async function currentRelease(prefix: string) {
  const target = await readlink(join(prefix, 'current')).catch(() => null)
  return target?.split('/').filter(Boolean).at(-1) ?? null
}

const DB_COPY = /^flytower\.db(-wal|-shm)?\.before-(.+)$/

/**
 * What `disk.prune-flytower` would remove: releases other than the running one and those in
 * the last update record (the one to go back to), leftover downloads, and database copies
 * kept for releases that are going. With no record, the newest other release is kept.
 */
export async function prunePlan(ctx: AgentContext): Promise<{ paths: string[]; names: string[] }> {
  const p = places(ctx)
  const current = await currentRelease(p.prefix)
  if (!current) return { paths: [], names: [] }
  const dir = join(p.prefix, 'releases')
  const entries = (await names(dir)).names
  const installed = entries.filter((n) => !n.startsWith('.') && existsSync(join(dir, n, 'VERSION')))
  const keep = new Set([current])
  const record = await readRecord(ctx.paths.state)
  if (record) {
    for (const v of [record.from, record.to]) if (installed.includes(v)) keep.add(v)
  } else {
    let newest: { name: string; at: number } | null = null
    for (const n of installed) {
      if (n === current) continue
      const at = (await stat(join(dir, n))).mtimeMs
      if (!newest || at > newest.at) newest = { name: n, at }
    }
    if (newest) keep.add(newest.name)
  }
  const out = { paths: [] as string[], names: [] as string[] }
  for (const n of entries) {
    if (keep.has(n)) continue
    out.paths.push(join(dir, n))
    out.names.push(n)
  }
  for (const n of (await names(p.data)).names) {
    const m = DB_COPY.exec(n)
    if (m && !keep.has(m[2]!)) {
      out.paths.push(join(p.data, n))
      out.names.push(n)
    }
  }
  return out
}

const sum = (ms: Measured[]) => ms.reduce((a, m) => a + m.bytes, 0)

export async function usage(
  params: Params<'disk.usage'>,
  ctx: AgentContext,
): Promise<Result<'disk.usage'>> {
  const walk = measurer(ctx.du ?? null)
  const p = places(ctx)

  // Every path in one walk, labelled, so a hard-linked file counts once overall.
  type Label =
    | { server: string; group: ServerGroup }
    | { shared: 'imports' | 'archive' }
    | { system: 'java' | 'flytower' | 'logs' | 'temp' }
  const paths: string[] = []
  const labels: Label[] = []
  const add = (path: string, label: Label) => {
    paths.push(path)
    labels.push(label)
  }
  const servers: Result<'disk.usage'>['servers'] = {}
  for (const server of params.servers) {
    const dir = join(p.servers, server)
    const listed = await names(dir)
    const level = await levelName(dir)
    servers[server] = {
      groups: { world: 0, logs: 0, content: 0, map: 0, backups: 0, exports: 0, other: 0 },
      unreadable: listed.unreadable,
    }
    for (const n of listed.names) add(join(dir, n), { server, group: groupOf(n, level) })
    add(join(p.backups, server), { server, group: 'backups' })
    add(join(p.exports, server), { server, group: 'exports' })
    add(join(p.maps, 'servers', server), { server, group: 'map' })
  }

  let skippedUnreadable = 0
  if (params.system) {
    add(p.imports, { shared: 'imports' })
    add(p.archive, { shared: 'archive' })
    // Only what's on the servers' disk: a tmpfs /tmp or a separate /var/log isn't this disk.
    const disk = (await deviceOf(p.servers)) ?? (await deviceOf(p.data)) ?? (await deviceOf('/'))
    const onDisk = async (path: string) => {
      const dev = await deviceOf(path)
      return dev !== null && dev === disk
    }
    // Everything measured elsewhere, so Flytower's own folders don't count it twice.
    const elsewhere = new Set(
      [p.servers, p.runtimes, p.backups, p.exports, p.maps, p.imports, p.archive].map((x) =>
        resolve(x),
      ),
    )
    const system = async (path: string, part: 'java' | 'flytower' | 'logs' | 'temp') => {
      if (!(await onDisk(path))) return
      add(path, { system: part })
    }
    await system(p.runtimes, 'java')
    for (const parent of [p.prefix, p.data]) {
      const listed = await names(parent)
      skippedUnreadable += listed.unreadable
      for (const n of listed.names) {
        const child = join(parent, n)
        if (!elsewhere.has(resolve(child))) await system(child, 'flytower')
      }
    }
    if (!elsewhere.has(resolve(p.config))) await system(p.config, 'flytower')
    await system(p.varLog, 'logs')
    for (const t of [p.apt, p.tmp, p.varTmp]) await system(t, 'temp')
  }

  const measured = await walk(paths)
  const shared = { imports: 0, archive: 0, unreadable: 0 }
  const parts = { java: 0, flytower: 0, logs: 0, temp: 0, unreadable: skippedUnreadable }
  labels.forEach((label, i) => {
    const m = measured[i]!
    if ('server' in label) {
      servers[label.server]!.groups[label.group] += m.bytes
      servers[label.server]!.unreadable += m.unreadable
    } else if ('shared' in label) {
      shared[label.shared] += m.bytes
      shared.unreadable += m.unreadable
    } else {
      parts[label.system] += m.bytes
      parts.unreadable += m.unreadable
    }
  })

  if (!params.system) return { servers, shared: null, system: null }

  // What each clean-up would free, in walks of their own (these overlap the parts above).
  const plan = await prunePlan(ctx)
  const [journal, apt, old] = await Promise.all([
    walk([p.journal]),
    walk(aptCache(p)),
    walk(plan.paths),
  ])
  return {
    servers,
    shared,
    system: {
      ...parts,
      journal: sum(journal),
      aptCache: sum(apt),
      oldReleases: sum(old),
    },
  }
}

export async function vacuumJournal(
  params: Params<'disk.vacuum-journal'>,
  ctx: AgentContext,
): Promise<Result<'disk.vacuum-journal'>> {
  const walk = measurer(ctx.du ?? null)
  const { journal } = places(ctx)
  const before = sum(await walk([journal]))
  const r = await ctx.exec('journalctl', [`--vacuum-size=${params.maxMb}M`])
  if (r.code === 127) throw new AgentError('not_found', "journalctl isn't on this machine")
  if (r.code !== 0) {
    throw new AgentError('failed', `couldn't shrink the journal: ${r.stderr.trim() || r.code}`)
  }
  const after = sum(await walk([journal]))
  return { freedBytes: Math.max(0, before - after) }
}

export async function cleanApt(
  _p: Params<'disk.clean-apt'>,
  ctx: AgentContext,
): Promise<Result<'disk.clean-apt'>> {
  const walk = measurer(ctx.du ?? null)
  const cache = aptCache(places(ctx))
  const before = sum(await walk(cache))
  const r = await ctx.exec('apt-get', ['clean'])
  if (r.code === 127) throw new AgentError('not_found', "apt isn't on this machine")
  if (r.code !== 0) {
    throw new AgentError('failed', `apt-get clean failed: ${r.stderr.trim() || r.code}`)
  }
  const after = sum(await walk(cache))
  return { freedBytes: Math.max(0, before - after) }
}

export async function pruneFlytower(
  _p: Params<'disk.prune-flytower'>,
  ctx: AgentContext,
): Promise<Result<'disk.prune-flytower'>> {
  await busy(ctx)
  const plan = await prunePlan(ctx)
  const walk = measurer(ctx.du ?? null)
  const freed = sum(await walk(plan.paths))
  for (const path of plan.paths) await rm(path, { recursive: true, force: true })
  return { freedBytes: freed, removed: plan.names }
}
