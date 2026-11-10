import { eq } from 'drizzle-orm'
import { schema } from '../db'
import { readPublicPage } from '../../shared/public-page'
import { routeHost } from '../status/hosts'

/**
 * A server's own hostname shows its public status page and nothing else of the panel. The
 * panel's own domain (NUXT_RP_ID, set by the installer) and plain IP addresses are untouched.
 */
export default defineEventHandler((event) => {
  const { rpId } = useRuntimeConfig()
  if (!rpId) return
  const host = (getRequestHost(event, { xForwardedHost: true }) ?? '')
    .replace(/:\d+$/, '')
    .toLowerCase()
  if (!host || host === rpId.toLowerCase()) return
  const row = useDb()
    .select({ name: schema.servers.name, publicPage: schema.servers.publicPage })
    .from(schema.servers)
    .where(eq(schema.servers.hostname, host))
    .get()
  if (!row) return
  const decision = routeHost({
    host,
    path: getRequestURL(event).pathname,
    panelDomain: rpId,
    server: { name: row.name, publicPage: readPublicPage(row.publicPage).enabled },
  })
  if (decision.kind === 'redirect') return sendRedirect(event, decision.to, 302)
  if (decision.kind === 'not-found') {
    throw createError({ statusCode: 404, statusMessage: 'Not found.' })
  }
})
