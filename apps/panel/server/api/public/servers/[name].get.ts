import { z } from 'zod'
import { publicStatus } from '../../../status/page'
import { withUuids } from '../../../players'

const Params = z.object({ name: z.string().max(40) })

/**
 * A server's public status, for its status page. Open without signing in, but only while the
 * server's public page is on; otherwise it's the same 404 as a name that doesn't exist.
 */
export default defineEventHandler(async (event) => {
  limit(event, 'public', 120, 60_000)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const row = findPublicServer(name)
  const page = row.publicPage
  const service = (await useStatus().current())[name] ?? 'unknown'
  const roster = await useRoster().view(name, service === 'active')
  const props = await readProperties(name).catch(() => ({}) as Record<string, string>)
  const max = Number.parseInt(props['max-players'] ?? '', 10)
  const usercache = page.show.players === 'names' ? await readUserCache(name) : []
  setResponseHeader(event, 'cache-control', 'public, max-age=15')
  return publicStatus({
    row,
    page,
    service,
    roster,
    machine: getRequestURL(event, { xForwardedHost: true }).hostname,
    motd: props.motd ?? '',
    icon: iconUrl(name)?.replace(`/api/servers/${name}/`, `/api/public/servers/${name}/`) ?? null,
    maxPlayers: Number.isFinite(max) ? max : null,
    withUuids: (names) => withUuids(names, usercache),
  })
})
