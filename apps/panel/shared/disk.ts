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

export interface DiskReport {
  servers: ServerDisk[]
  /** Uploads waiting to be imported, and deleted servers' archives. */
  shared: { imports: number; archive: number; unreadable: number } | null
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
