import { z } from 'zod'

const Body = z.object({ ttl: z.enum(['1h', '24h', '7d']) })

/** Makes a share link. The URL is only shown in this response. */
export default defineEventHandler(async (event) => {
  const { user, name } = await backupContext(event)
  const id = Number(getRouterParam(event, 'id'))
  const { ttl } = await readValidatedBody(event, Body.parse)
  const { token, share } = backupHttp(() => useExports().share(name, id, ttl, user.id))
  audit(user.id, 'world.share', name, { exportId: id, shareId: share.id, ttl })
  const origin = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
  return { url: `${origin}/share/${token}`, expiresAt: share.expiresAt, id: share.id }
})
