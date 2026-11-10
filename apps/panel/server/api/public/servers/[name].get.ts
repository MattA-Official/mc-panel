import { z } from 'zod'

const Params = z.object({ name: z.string().max(40) })

/**
 * A server's public status, for its status page. Open without signing in, but only while the
 * server's public page is on; otherwise it's the same 404 as a name that doesn't exist.
 */
export default defineEventHandler(async (event) => {
  limit(event, 'public', 120, 60_000)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const row = findPublicServer(name)
  const status = await buildPublicStatus(
    row,
    row.publicPage,
    getRequestURL(event, { xForwardedHost: true }).hostname,
  )
  setResponseHeader(event, 'cache-control', 'public, max-age=15')
  return status
})
