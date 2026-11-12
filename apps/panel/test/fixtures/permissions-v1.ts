/**
 * Frozen copy of shared/permissions.ts from 1.3.0, before #126 split the broad permissions.
 * The migration test checks that every route answers the same way under the old and new keys.
 */
/**
 * What a person can do in the panel. Every API route and live topic checks one of these
 * through `requirePermission`; roles are just named sets of them.
 */

/** Granted for one server, or for all servers. */
export const SERVER_PERMISSIONS = [
  'server.view',
  'server.power',
  'console.read',
  'console.command',
  'players.manage',
  'backups.create',
  'backups.download',
  'backups.restore',
  'backups.delete',
  'world.manage',
  'files.read',
  'files.write',
  'server.configure',
  'server.delete',
] as const

/** Only count when the role is granted for all servers. */
export const INSTALL_PERMISSIONS = [
  'servers.create',
  'people.manage',
  'system.manage',
  'activity.all',
] as const

export type ServerPermission = (typeof SERVER_PERMISSIONS)[number]
export type InstallPermission = (typeof INSTALL_PERMISSIONS)[number]
export type Permission = ServerPermission | InstallPermission

export const ALL_PERMISSIONS: readonly Permission[] = [
  ...SERVER_PERMISSIONS,
  ...INSTALL_PERMISSIONS,
]

export const isServerPermission = (p: Permission): p is ServerPermission =>
  (SERVER_PERMISSIONS as readonly string[]).includes(p)

export type BuiltInRole = 'owner' | 'admin' | 'operator' | 'viewer'

/** The roles every install has. Their permissions live here, so an update can widen them. */
export const BUILT_IN_ROLES: Record<BuiltInRole, { name: string; permissions: Permission[] }> = {
  owner: { name: 'Owner', permissions: [...ALL_PERMISSIONS] },
  admin: { name: 'Admin', permissions: [...SERVER_PERMISSIONS, 'servers.create'] },
  operator: {
    name: 'Operator',
    permissions: [
      'server.view',
      'server.power',
      'console.read',
      'console.command',
      'players.manage',
      'backups.create',
    ],
  },
  viewer: { name: 'Viewer', permissions: ['server.view'] },
}

export const isBuiltInRole = (id: string): id is BuiltInRole => id in BUILT_IN_ROLES

/** One grant: a role, for one server or (server null) for all of them. */
export interface Grant {
  permissions: readonly Permission[]
  server: string | null
}

/**
 * Everything one person can do, folded from their grants. Sent to the browser as-is
 * (`/api/auth/state`) so the UI can hide what they can't use.
 */
export interface Access {
  /** From grants for all servers: install permissions, and server permissions everywhere. */
  all: Permission[]
  /** Server permissions from grants for single servers, by server name. */
  servers: Record<string, ServerPermission[]>
}

export function foldGrants(grants: readonly Grant[]): Access {
  const all = new Set<Permission>()
  const servers: Record<string, Set<ServerPermission>> = {}
  for (const g of grants) {
    for (const p of g.permissions) {
      if (g.server === null) all.add(p)
      else if (isServerPermission(p)) (servers[g.server] ??= new Set()).add(p)
    }
  }
  return {
    all: ALL_PERMISSIONS.filter((p) => all.has(p)),
    servers: Object.fromEntries(
      Object.entries(servers).map(([name, set]) => [
        name,
        SERVER_PERMISSIONS.filter((p) => set.has(p)),
      ]),
    ),
  }
}

/** Whether `access` allows `permission`, on `server` for server permissions. */
export function can(access: Access, permission: Permission, server?: string): boolean {
  if (access.all.includes(permission)) return true
  if (!server || !isServerPermission(permission)) return false
  return access.servers[server]?.includes(permission) ?? false
}

/** Whether `access` allows `permission` on at least one server. */
export function canAnywhere(access: Access, permission: ServerPermission): boolean {
  return (
    access.all.includes(permission) ||
    Object.values(access.servers).some((ps) => ps.includes(permission))
  )
}

export const NO_ACCESS: Access = { all: [], servers: {} }

/** What each permission lets someone do, for the role editor. */
export const PERMISSION_LABELS: Record<Permission, { label: string; help: string }> = {
  'server.view': { label: 'See the server', help: "Status, settings, who's online, backups list." },
  'server.power': { label: 'Start and stop', help: 'Start, stop and restart.' },
  'console.read': { label: 'Read the console and logs', help: "They show players' IP addresses." },
  'console.command': { label: 'Send console commands', help: 'Anything an operator can type.' },
  'players.manage': { label: 'Manage players', help: 'Whitelist, operators, bans and kicks.' },
  'backups.create': { label: 'Take backups', help: 'Back up now and send backups off-site.' },
  'backups.download': {
    label: 'Download worlds',
    help: 'Backups, exports and share links hold the whole world.',
  },
  'backups.restore': { label: 'Restore backups', help: 'Replaces the world.' },
  'backups.delete': { label: 'Delete backups', help: 'Backups, exports and past worlds.' },
  'world.manage': { label: 'Manage the world', help: 'Reset, copy, pregenerate and export.' },
  'files.read': { label: 'Read files', help: 'The Files tab, read only.' },
  'files.write': { label: 'Change files', help: 'Upload, edit, rename and delete.' },
  'server.configure': {
    label: 'Change settings',
    help: 'Settings, properties, content, YAML, schedules and the public page.',
  },
  'server.delete': { label: 'Delete the server', help: 'Gone for good, after a passkey check.' },
  'servers.create': { label: 'Create servers', help: 'New, imported and cloned servers.' },
  'people.manage': { label: 'Manage people', help: 'Invites, roles and removing people.' },
  'system.manage': {
    label: 'Manage Flytower',
    help: 'Updates, SSH, notifications, Discord, off-site storage and branding.',
  },
  'activity.all': { label: 'See all activity', help: 'Otherwise only for servers they can see.' },
}
