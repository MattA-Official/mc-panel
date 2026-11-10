import type { H3Event } from 'h3'
import { mayManageAccess, PeopleError } from '../auth/people'

/** Runs a people change, turning PeopleError into the right HTTP answer. */
export function peopleCall<T>(fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    if (e instanceof PeopleError)
      throw createError({ statusCode: e.status, statusMessage: e.message })
    throw e
  }
}

/** The address an invite or setup link points at, on this panel. */
export function panelLink(event: H3Event, path: string, token: string): string {
  return `${getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin}${path}#token=${token}`
}

/**
 * For a server's Access section: Manage people anywhere, or Manage who has access on this
 * server. Called after `requireServerPermission(event, 'server.view')`.
 */
export function requireAccessManager(event: H3Event, server: string) {
  if (!mayManageAccess(eventAccess(event), server)) {
    throw createError({
      statusCode: 403,
      statusMessage: "You can't change who has access to this server.",
    })
  }
}
