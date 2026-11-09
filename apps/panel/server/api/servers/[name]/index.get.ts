import { z } from 'zod'

const Params = z.object({ name: z.string().max(40) })

export default defineEventHandler(async (event) => {
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const row = findServer(name)
  const statuses = await useStatus().current()
  return publicServer(row, statuses[name] ?? 'unknown', useCrashes().health([name])[name])
})
