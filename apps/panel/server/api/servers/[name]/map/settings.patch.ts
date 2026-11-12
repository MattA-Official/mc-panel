import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '../../../../db'
import { MapSettings, readMapSettings, sameMapSettings } from '../../../../../shared/map-settings'

const Params = z.object({ name: z.string().max(40) })

/** Turns the map on or off, who may open it, and whether it shows players. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'community.manage')
  const { user } = await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const body = await readValidatedBody(event, MapSettings.parse)
  const server = findServer(name)
  const was = readMapSettings(server.map)
  if (sameMapSettings(was, body)) return { changed: false }
  useDb().update(schema.servers).set({ map: body }).where(eq(schema.servers.name, name)).run()
  await useMap().sync(name)
  audit(user.id, 'server.map', name, { ...body, was })
  return { changed: true }
})
