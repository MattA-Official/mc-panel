import { timingSafeEqual } from 'node:crypto'
import { uuidHex } from '@flytower/providers'
import { HeadError, renderHead } from '../../../skins/head'

/**
 * A player's face, for the avatar on their chat in Discord. Discord fetches it from here, so
 * it's open, but the address carries a signature only the panel can make: it works for the
 * players whose chat was posted, and can't be used to look up anyone else through this panel.
 */
export default defineEventHandler(async (event) => {
  limit(event, 'public-heads', 600, 60_000)
  const notFound = () => createError({ statusCode: 404, statusMessage: 'No such player.' })
  const file = getRouterParam(event, 'file') ?? ''
  const uuid = file.endsWith('.png') ? file.slice(0, -4).toLowerCase() : ''
  const hex = uuidHex(uuid)
  const sig = String(getQuery(event).s ?? '')
  if (!hex || !/^[0-9a-f]{24}$/.test(sig)) throw notFound()
  const want = Buffer.from(await headSignature(uuid))
  if (!timingSafeEqual(want, Buffer.from(sig))) throw notFound()
  const skin = await useSkins().skin(hex)
  if (!skin) throw createError({ statusCode: 503, statusMessage: "Couldn't get the skin." })
  let png: Uint8Array
  try {
    png = renderHead(skin)
  } catch (err) {
    if (err instanceof HeadError) throw createError({ statusCode: 503, statusMessage: err.message })
    throw err
  }
  setResponseHeaders(event, {
    'content-type': 'image/png',
    'cache-control': 'public, max-age=86400',
  })
  return png
})
