import { z } from 'zod'
import { publicStatus } from '../../../status/page'
import { withUuids } from '../../../players'
import { readLock } from '../../../spec/lock'

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
  const lock = await readLock(serverDir(name)).catch(() => null)
  // A pack built since the last change that turned out empty isn't offered.
  const hasPack =
    !!lock &&
    usePacks().peek(row, lock, page.pack.extras)?.path !== null &&
    (page.pack.extras.length > 0 ||
      lock.content.some((i) => i.kind === 'mod' && i.source === 'modrinth'))
  setResponseHeader(event, 'cache-control', 'public, max-age=15')
  return publicStatus({
    row,
    page,
    service,
    roster,
    machine: getRequestURL(event, { xForwardedHost: true }).hostname,
    motd: props.motd ?? '',
    hasPack,
    icon: iconUrl(name)?.replace(`/api/servers/${name}/`, `/api/public/servers/${name}/`) ?? null,
    maxPlayers: Number.isFinite(max) ? max : null,
    withUuids: (names) => withUuids(names, usercache),
    statsEnabled: statsSettings(name).enabled,
  })
})
