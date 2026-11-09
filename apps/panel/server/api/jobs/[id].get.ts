import { z } from 'zod'

const Params = z.object({ id: z.coerce.number().int().positive() })

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, Params.parse)
  const job = useJobs().get(id)
  if (!job) throw createError({ statusCode: 404, statusMessage: 'No such job.' })
  return job
})
