/**
 * Disk use: how a server's space is split up, and the warning levels. Shared by the
 * browser and the panel's API.
 */

/** The groups a server's space is split into, in the order they're shown. */
export const DISK_GROUPS = {
  world: 'World',
  backups: 'Backups',
  exports: 'World exports',
  logs: 'Logs and crash reports',
  content: 'Mods, plugins and config',
  map: 'Web map',
  other: 'Other',
} as const
export type DiskGroup = keyof typeof DISK_GROUPS

export interface ServerDisk {
  server: string
  /** Everything the server has on disk, backups and exports included. */
  bytes: number
  groups: Record<DiskGroup, number>
  /** Folders or files Flytower couldn't read, so the figures are a floor. */
  unreadable: number
  measuredAt: string
}

/**
 * The rest of the machine, in the order shown. Everything else ("Operating system and
 * everything else") is what's left of the used space once these and the servers are counted.
 */
export const SYSTEM_PARTS = {
  java: 'Java runtimes',
  flytower: 'Flytower',
  logs: 'System logs',
  temp: 'Package cache and temp files',
} as const
export type SystemPart = keyof typeof SYSTEM_PARTS

export interface SystemDisk extends Record<SystemPart, number> {
  /** Folders or files that couldn't be read, so the figures are a floor. */
  unreadable: number
  /** What each clean-up would free: the systemd journal, apt's cache, old releases. */
  journal: number
  aptCache: number
  oldReleases: number
}

/** The clean-up actions, each tied to the part it frees space in. */
export const CLEAN_UPS = {
  journal: { part: 'logs', label: 'Shrink the journal' },
  apt: { part: 'temp', label: 'Clear the package cache' },
  releases: { part: 'flytower', label: 'Remove old versions' },
} as const satisfies Record<string, { part: SystemPart; label: string }>
export type CleanUp = keyof typeof CLEAN_UPS

/** The machine Flytower runs on. Every report names one, ready for several (#29). */
export const LOCAL_MACHINE = 'local'

export interface DiskReport {
  /** Which machine this report is for. */
  machine?: string
  servers: ServerDisk[]
  /** Uploads waiting to be imported, and deleted servers' archives. */
  shared: { imports: number; archive: number; unreadable: number } | null
  /**
   * The rest of the machine in parts, measured by the agent as root. Null when the agent
   * can't (an older agent, or it failed), which leaves one "System and other files" slice.
   */
  system?: SystemDisk | null
  measuredAt: string | null
}

/** Above these, Flytower warns (85%) and then stops scheduled backups (95%). */
export const DISK_WARN = 85
export const DISK_URGENT = 95

export type DiskLevel = 'ok' | 'warning' | 'urgent'

export function diskLevel(percent: number | null): DiskLevel {
  if (percent === null) return 'ok'
  if (percent >= DISK_URGENT) return 'urgent'
  if (percent >= DISK_WARN) return 'warning'
  return 'ok'
}
