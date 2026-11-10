import { MACHINE, series } from '../../metrics/sampler'

/** The machine's CPU, memory and disk over the last hour, day or week. */
export default defineEventHandler(async (event) => {
  await requireSignedIn(event)
  const { range } = await getValidatedQuery(event, RangeQuery.parse)
  const latest = useMetrics().latest
  return {
    ...series(useDb(), MACHINE, range, Date.now()),
    limits: { memMb: latest?.memTotalMb ?? null, diskMb: latest?.diskTotalMb ?? null },
  }
})
