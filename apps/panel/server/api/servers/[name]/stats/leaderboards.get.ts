import { z } from 'zod'
import { PERIODS } from '../../../../../shared/leaderboards'

const Params = z.object({ name: z.string().max(40) })
const Query = z.object({ period: z.enum(PERIODS).default('all') })

/**
 * The Stats tab: each leaderboard's top ten and a card per player, for all time, this month
 * or this week (in the server's time zone). Left-out players never appear.
 */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.view')
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const { period } = await getValidatedQuery(event, Query.parse)
  findServer(name)
  return statsOverview(name, period)
})
