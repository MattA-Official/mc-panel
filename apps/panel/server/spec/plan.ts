/**
 * Works out what applying a spec would change, without changing anything. The result is
 * shown to the person first and then handed to apply unchanged.
 */
import {
  resolveAll,
  type ContentProvider,
  type VanillaTweaksProvider,
  type ResolvedContent,
  type WantedContent,
} from '@flytower/providers'
import { mbToMemory, type ServerSpec } from '../../shared/spec'
import type { schema } from '../db'
import { formatBytes } from '../backups/service'
import { contentDir, type Lock, type LockedItem } from './lock'

type ServerRow = typeof schema.servers.$inferSelect

export interface Change {
  area: 'content' | 'settings' | 'properties' | 'backups'
  action: 'add' | 'update' | 'remove' | 'reinstall' | 'set'
  label: string
  from?: string
  to?: string
  /** Why a dependency is coming along. */
  note?: string
}

export interface Download extends ResolvedContent {
  path: string
  requiredBy: string[]
}

export interface SettingsChange {
  displayName?: string
  memoryMb?: number
  port?: number
  properties: Record<string, string>
  backups?: {
    schedule: string | null
    timezone: string
    keep: { last: number; daily: number; weekly: number }
  }
  content: ServerSpec['content']
}

export interface Plan {
  server: string
  changes: Change[]
  /** Anything here stops apply. */
  problems: string[]
  restart: boolean
  backup: boolean
  downloadBytes: number
  unmanaged: string[]
  /** What apply does; not shown as-is. */
  work: {
    downloads: Download[]
    /** Paths to take away (removed, or replaced by an update). */
    removals: string[]
    /** The lockfile once applied; new items get their SHA-256 when downloaded. */
    lock: Lock
    settings: SettingsChange
  }
}

export interface PlanInput {
  row: ServerRow
  props: Record<string, string>
  lock: Lock
  spec: ServerSpec
  levelName: string
  /** Which locked paths are really on disk. */
  exists: (path: string) => Promise<boolean>
  unmanaged: string[]
  /** Ports other servers use, for the clash check. */
  otherPorts: { name: string; port: number; rconPort: number }[]
  /** Projects (ids or slugs) allowed to move to a newer version, or true for all. */
  upgrade?: true | string[]
  modrinth: ContentProvider
  vanillatweaks?: VanillaTweaksProvider
  now?: () => Date
}

const lockedKey = (l: Pick<LockedItem, 'source' | 'projectId'>) => `${l.source}:${l.projectId}`

function toWanted(item: ServerSpec['content'][number]): WantedContent {
  if ('modrinth' in item) return { modrinth: item.modrinth, version: item.version, kind: item.kind }
  if ('vanillatweaks' in item) return { vanillatweaks: item.vanillatweaks, tweak: item.tweak }
  return { url: item.url, sha256: item.sha256, kind: item.kind, filename: item.filename }
}

export async function makePlan(input: PlanInput): Promise<Plan> {
  const { row, props, lock, spec } = input
  const changes: Change[] = []
  const problems: string[] = []

  if (spec.name !== row.name) {
    problems.push(`This spec is for "${spec.name}", not "${row.name}". Names can't change.`)
  }
  if (spec.loader.type !== row.loader || spec.loader.minecraft !== row.mcVersion) {
    problems.push(
      'Changing the loader or Minecraft version is coming in a later release. Put loader back to ' +
        `${row.loader} ${row.mcVersion} for now.`,
    )
  } else if (
    spec.loader.version &&
    row.loaderVersion &&
    spec.loader.version !== row.loaderVersion
  ) {
    problems.push('Changing the Fabric loader version is coming in a later release.')
  }

  // Settings.
  const settings: SettingsChange = { properties: {}, content: spec.content }
  if (spec.displayName !== undefined && spec.displayName !== row.displayName) {
    settings.displayName = spec.displayName
    changes.push({
      area: 'settings',
      action: 'set',
      label: 'Display name',
      from: row.displayName,
      to: spec.displayName,
    })
  }
  if (spec.memory !== undefined && spec.memory !== row.memoryMb) {
    settings.memoryMb = spec.memory
    changes.push({
      area: 'settings',
      action: 'set',
      label: 'Memory',
      from: mbToMemory(row.memoryMb),
      to: mbToMemory(spec.memory),
    })
  }
  if (spec.port !== undefined && spec.port !== row.port) {
    const clash = input.otherPorts.find(
      (o) => o.name !== row.name && (o.port === spec.port || o.rconPort === spec.port),
    )
    if (clash || spec.port === row.rconPort) {
      problems.push(
        `Port ${spec.port} is already used${clash ? ` by ${clash.name}` : ' for RCON'}.`,
      )
    } else {
      settings.port = spec.port
      changes.push({
        area: 'settings',
        action: 'set',
        label: 'Port',
        from: String(row.port),
        to: String(spec.port),
      })
    }
  }
  for (const [key, raw] of Object.entries(spec.properties)) {
    const value = String(raw)
    if (props[key] === value) continue
    settings.properties[key] = value
    changes.push({
      area: 'properties',
      action: props[key] === undefined ? 'add' : 'set',
      label: key,
      from: props[key],
      to: value,
    })
  }
  if (spec.backups) {
    const b = spec.backups
    const same =
      b.schedule === row.backupSchedule &&
      b.timezone === row.backupTz &&
      b.keep.last === row.keepLast &&
      b.keep.daily === row.keepDaily &&
      b.keep.weekly === row.keepWeekly
    if (!same) {
      settings.backups = b
      changes.push({
        area: 'backups',
        action: 'set',
        label: 'Backups',
        from: describeBackups(row.backupSchedule, row.backupTz, [
          row.keepLast,
          row.keepDaily,
          row.keepWeekly,
        ]),
        to: describeBackups(b.schedule, b.timezone, [b.keep.last, b.keep.daily, b.keep.weekly]),
      })
    }
  }

  // Content.
  const accepts = row.loader === 'vanilla' ? ['datapack'] : ['mod', 'datapack']
  for (const item of spec.content) {
    const kind = item.kind
    if (kind && !accepts.includes(kind)) {
      problems.push(`A ${row.loader} server can't run ${kind}s.`)
    }
  }
  const upgrading = (l: LockedItem) =>
    input.upgrade === true || (input.upgrade ?? []).some((u) => u === l.projectId || u === l.slug)
  const pinnedBy = new Map<string, string>()
  for (const l of lock.content) {
    if (l.source === 'url' || upgrading(l)) continue
    pinnedBy.set(l.projectId, l.versionId)
    pinnedBy.set(l.slug, l.versionId)
  }
  const resolved = await resolveAll(
    spec.content.map(toWanted),
    { loader: row.loader, minecraft: row.mcVersion },
    input.modrinth,
    { pinned: (p) => pinnedBy.get(p), vanillatweaks: input.vanillatweaks },
  )
  problems.push(...resolved.problems)
  for (const item of resolved.items) {
    if (!accepts.includes(item.kind)) {
      problems.push(`${item.title} is a ${item.kind}, which a ${row.loader} server can't run.`)
    }
  }

  const before = new Map(lock.content.map((l) => [lockedKey(l), l]))
  const downloads: Download[] = []
  const removals: string[] = []
  const nextLock: LockedItem[] = []
  for (const item of resolved.items) {
    const path = `${contentDir(item.kind, input.levelName)}/${item.filename}`
    const old = before.get(lockedKey(item))
    before.delete(lockedKey(item))
    const note = item.requiredBy.length ? `Needed by ${item.requiredBy.join(', ')}` : undefined
    const locked: LockedItem = {
      source: item.source,
      projectId: item.projectId,
      slug: item.slug,
      title: item.title,
      versionId: item.versionId,
      versionNumber: item.versionNumber,
      kind: item.kind,
      path,
      url: item.url,
      sha256: item.hash?.algorithm === 'sha256' ? item.hash.value : '',
      ...(item.hash?.algorithm === 'sha512' ? { sha512: item.hash.value } : {}),
      size: item.size,
      requiredBy: item.requiredBy,
    }
    if (old && old.versionId === item.versionId && old.path === path) {
      if (await input.exists(path)) {
        nextLock.push({ ...old, requiredBy: item.requiredBy })
        continue
      }
      changes.push({
        area: 'content',
        action: 'reinstall',
        label: item.title,
        to: item.versionNumber,
        note: 'The file is missing',
      })
    } else if (old) {
      removals.push(old.path)
      changes.push({
        area: 'content',
        action: 'update',
        label: item.title,
        from: old.versionNumber,
        to: item.versionNumber,
        note,
      })
    } else {
      changes.push({
        area: 'content',
        action: 'add',
        label: item.title,
        to: item.versionNumber,
        note,
      })
    }
    if (input.unmanaged.includes(path)) {
      problems.push(
        `${path} is already there, added by hand. Remove it first, or leave ${item.title} out.`,
      )
    }
    downloads.push({ ...item, path, requiredBy: item.requiredBy })
    nextLock.push(locked)
  }
  for (const old of before.values()) {
    removals.push(old.path)
    changes.push({ area: 'content', action: 'remove', label: old.title, from: old.versionNumber })
  }

  const contentChanged = downloads.length > 0 || removals.length > 0
  const restart =
    contentChanged ||
    settings.memoryMb !== undefined ||
    settings.port !== undefined ||
    Object.keys(settings.properties).length > 0
  return {
    server: row.name,
    changes,
    problems: [...new Set(problems)],
    restart,
    backup: contentChanged,
    downloadBytes: downloads.reduce((n, d) => n + (d.size ?? 0), 0),
    unmanaged: input.unmanaged,
    work: {
      downloads,
      removals: [...new Set(removals)],
      lock: {
        version: 1,
        updatedAt: (input.now?.() ?? new Date()).toISOString(),
        content: nextLock,
      },
      settings,
    },
  }
}

function describeBackups(schedule: string | null, tz: string, keep: number[]) {
  return `${schedule ? `${schedule} (${tz})` : 'off'}, keep ${keep.join('/')}`
}

/** One line for a person, like "Add Lithium 0.18.0 (12 MB to download)". */
export function summarise(plan: Plan): string {
  if (!plan.changes.length) return 'Nothing to change.'
  const n = plan.changes.length
  const dl = plan.downloadBytes ? `, ${formatBytes(plan.downloadBytes)} to download` : ''
  return `${n} change${n === 1 ? '' : 's'}${dl}${plan.restart ? ', then a restart' : ''}.`
}
