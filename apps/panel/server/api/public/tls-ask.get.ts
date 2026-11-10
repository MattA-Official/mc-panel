import { eq } from 'drizzle-orm'
import { schema } from '../../db'
import { readPublicPage } from '../../../shared/public-page'
import { mayServeHost } from '../../status/hosts'

/**
 * Caddy asks this before getting a certificate for a name it hasn't seen (on-demand TLS), so
 * certificates are only issued for server hostnames whose public page is on.
 */
export default defineEventHandler((event) => {
  const domain = String(getQuery(event).domain ?? '')
    .trim()
    .toLowerCase()
  const row = domain
    ? useDb()
        .select({ publicPage: schema.servers.publicPage })
        .from(schema.servers)
        .where(eq(schema.servers.hostname, domain))
        .get()
    : undefined
  const ok = mayServeHost(row ? { publicPage: readPublicPage(row.publicPage).enabled } : null)
  if (!ok) throw createError({ statusCode: 404, statusMessage: 'Not a public server hostname.' })
  return { ok: true }
})
