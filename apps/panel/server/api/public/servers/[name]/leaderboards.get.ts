import { z } from 'zod'
import { PERIODS } from '../../../../../shared/leaderboards'

const Params = z.object({ name: z.string().max(40) })
const Query = z.object({ period: z.enum(PERIODS).default('all') })

/**
 * The leaderboards on a server's public page: the top five on each board, names and figures
 * only. The same 404 as a missing page unless the page shows player names, leaderboards are
 * turned on and the server keeps stats. Left-out players never appear.
 */
export default defineEventHandler(async (event) => {
  limit(event, 'public', 120, 60_000)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const { period } = await getValidatedQuery(event, Query.parse)
  const row = findPublicServer(name)
  const boards = await publicLeaderboards(name, row.publicPage, period)
  if (!boards) throw createError({ statusCode: 404, statusMessage: 'Not found.' })
  setResponseHeader(event, 'cache-control', 'public, max-age=300')
  return boards
})
