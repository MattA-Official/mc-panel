import { series } from '../../../metrics/sampler'
import { costOf } from '../../../memory'

/** The server's CPU, memory, players and tick time over the last hour, day or week. */
export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const name = getRouterParam(event, 'name') ?? ''
  const row = findServer(name)
  const { range } = await getValidatedQuery(event, RangeQuery.parse)
  return {
    ...series(useDb(), row.name, range, Date.now()),
    limits: { memMb: costOf(row.memoryMb) },
  }
})
