import { uuidHex } from '@flytower/providers'

/**
 * A player's skin, for drawing their head. Fetched from Mojang by the panel and cached on
 * disk, so browsers never contact a third party about who plays here.
 */
export default defineEventHandler(async (event) => {
  const file = getRouterParam(event, 'file') ?? ''
  const hex = file.endsWith('.png') ? uuidHex(file.slice(0, -4)) : null
  if (!hex) throw createError({ statusCode: 404, statusMessage: 'No such player.' })
  const png = await useSkins().skin(hex)
  if (!png) throw createError({ statusCode: 503, statusMessage: "Couldn't get the skin." })
  setResponseHeaders(event, {
    'content-type': 'image/png',
    'cache-control': 'private, max-age=3600',
  })
  return png
})
