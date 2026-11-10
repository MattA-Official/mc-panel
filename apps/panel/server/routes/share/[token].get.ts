import { schema } from '../../db'
import { eq } from 'drizzle-orm'

/**
 * A world download for someone without an account. Unknown, expired and revoked links all
 * get the same 404 so nothing can be learned by guessing.
 */
export default defineEventHandler((event) => {
  limit(event, 'share', 30)
  const token = getRouterParam(event, 'token') ?? ''
  const exports = useExports()
  const row = exports.redeem(token)
  if (!row)
    throw createError({
      statusCode: 404,
      statusMessage: 'This link has expired or was turned off.',
    })
  const server = useDb()
    .select({ displayName: schema.servers.displayName })
    .from(schema.servers)
    .where(eq(schema.servers.name, row.server))
    .get()
  return zipResponse(
    exports.path(row),
    row.name ? `${row.name}.zip` : `${server?.displayName ?? row.server} world.zip`,
  )
})
