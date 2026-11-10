import { uuidHex } from '@flytower/providers'
import { withUuids } from '../../../../../players'

/**
 * The skin of a player who's online on a public server whose page shows names, for their
 * head on the page. Anyone else's skin stays behind sign-in, so the page can't be used to
 * look up arbitrary players through this panel.
 */
export default defineEventHandler(async (event) => {
  limit(event, 'public-skins', 600, 60_000)
  const name = getRouterParam(event, 'name') ?? ''
  const file = getRouterParam(event, 'file') ?? ''
  const notFound = () => createError({ statusCode: 404, statusMessage: 'No such player.' })
  const hex = file.endsWith('.png') ? uuidHex(file.slice(0, -4)) : null
  if (!hex) throw notFound()
  const row = findPublicServer(name)
  if (row.publicPage.show.players !== 'names') throw notFound()
  const service = (await useStatus().current())[name] ?? 'unknown'
  const roster = await useRoster().view(name, service === 'active')
  const online = withUuids(roster.players ?? [], await readUserCache(name))
  if (!online.some((p) => uuidHex(p.uuid) === hex)) throw notFound()
  const png = await useSkins().skin(hex)
  if (!png) throw createError({ statusCode: 503, statusMessage: "Couldn't get the skin." })
  setResponseHeaders(event, {
    'content-type': 'image/png',
    'cache-control': 'public, max-age=3600',
  })
  return png
})
