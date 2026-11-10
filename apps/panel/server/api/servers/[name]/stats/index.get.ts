import { z } from 'zod'

const Params = z.object({ name: z.string().max(40) })
const Query = z.object({
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

/**
 * Each player's kept stats: all time, or gained since a day (YYYY-MM-DD) for week and month
 * figures. The raw numbers are in Minecraft's units (ticks, centimetres, tenths of a heart).
 */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.view')
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const { since } = await getValidatedQuery(event, Query.parse)
  findServer(name)
  return { players: useStatsSnapshot().totals(name, since) }
})
