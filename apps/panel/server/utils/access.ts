import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { schema } from '../db'
import { loadAccess } from '../auth/access'
import { can, type Access, type Permission } from '../../shared/permissions'
import type { UpdatesSnapshot } from '../../shared/updates'

/**
 * Requires a signed-in person who still exists, and returns their session and access.
 * For routes any signed-in person may use (their own account, passkeys, look-ups).
 */
export async function requireSignedIn(event: H3Event) {
  const session = await requireUserSession(event)
  // The auth middleware usually loaded it already for this request.
  const cached = event.context.access as Access | undefined
  const access = cached ?? loadAccess(useDb(), session.user.id, session.sessionVersion)
  if (!access) {
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'Sign in first.' })
  }
  event.context.access = access
  return { session, access }
}

/**
 * Requires `permission`, on `server` when given. A person who can't see the server gets the
 * same 404 as for a server that doesn't exist, so names don't leak.
 */
export async function requirePermission(event: H3Event, permission: Permission, server?: string) {
  const result = await requireSignedIn(event)
  const { access } = result
  if (
    server !== undefined &&
    !can(access, 'server.view', server) &&
    !can(access, permission, server)
  ) {
    throw createError({ statusCode: 404, statusMessage: 'No such server.' })
  }
  if (!can(access, permission, server)) {
    throw createError({ statusCode: 403, statusMessage: "You don't have permission to do that." })
  }
  return result
}

/** Shorthand for server routes: the server comes from the `name` route parameter. */
export async function requireServerPermission(event: H3Event, permission: Permission) {
  const server = getRouterParam(event, 'name') ?? ''
  const result = await requirePermission(event, permission, server)
  return { ...result, server }
}

/** The access loaded for this request by one of the helpers above. */
export function eventAccess(event: H3Event): Access {
  const access = event.context.access as Access | undefined
  if (!access) throw new Error('eventAccess() before requireSignedIn()')
  return access
}

/**
 * Whether this person may follow job `id`: jobs for a server need `server.view` on it; jobs
 * for no server (imports, panel updates) are open to whoever started them or can see them.
 */
export function canSeeJob(access: Access, id: number): boolean {
  const row = useDb()
    .select({ server: schema.jobs.server })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, id))
    .get()
  if (!row) return true // The route answers 404 itself.
  return row.server === null || can(access, 'server.view', row.server)
}

/** The update check's findings, with only the servers this person can see. */
export function visibleUpdates(snapshot: UpdatesSnapshot, access: Access): UpdatesSnapshot {
  return {
    ...snapshot,
    servers: Object.fromEntries(
      Object.entries(snapshot.servers).filter(([name]) => can(access, 'server.view', name)),
    ),
  }
}
