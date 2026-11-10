import { PERMISSION_LABELS, type Permission } from '#shared/permissions'

/** What /api/people returns, shared by the People and Roles tabs on Access. */
export interface GrantView {
  roleId: string
  server: string | null
}
export interface Person {
  id: number
  name: string
  joinedAt: string
  lastSignIn: string | null
  passkeys: number
  grants: GrantView[]
}
export interface InviteView {
  id: number
  roleId: string
  server: string | null
  note: string | null
  invitedBy: string | null
  createdAt: string
  expiresAt: string
}
export interface RoleView {
  id: string
  name: string
  builtIn: boolean
  permissions: Permission[]
}
export interface PeopleView {
  people: Person[]
  invites: InviteView[]
  roles: RoleView[]
  you: number
}

const ROLE_HELP: Record<string, string> = {
  owner: 'Everything, including people, updates, SSH and off-site storage.',
  admin: 'Everything on their servers: settings, files, backups, worlds and deleting.',
  operator: 'Start and stop, the console, players and taking backups.',
  viewer: "Status and who's online. No console or logs.",
}

/** One line on what a role allows. */
export const roleHelp = (r: RoleView) =>
  ROLE_HELP[r.id] ?? r.permissions.map((p) => PERMISSION_LABELS[p].label).join(', ')
