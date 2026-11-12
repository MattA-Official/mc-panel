import { z } from 'zod'
import { readMapSettings } from '../../../../../shared/map-settings'

const Params = z.object({ name: z.string().max(40) })
const Body = z.object({ full: z.boolean().default(false) }).default({ full: false })

/**
 * Draws the map now, rather than waiting for the next save. `full` redraws every region,
 * not just the ones that changed. Returns at once; the map topic says when it's done.
 */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'world.manage')
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const { full } = await readValidatedBody(event, (b) => Body.parse(b ?? undefined))
  const server = findServer(name)
  if (!readMapSettings(server.map).enabled) {
    throw createError({ statusCode: 409, statusMessage: 'Turn the map on first.' })
  }
  void useMap().draw(name, { full })
  return { queued: true }
})
