import { z } from 'zod'

const Params = z.object({ id: z.coerce.number().int().positive() })

export default defineEventHandler(async (event) => {
  const { access } = await requireSignedIn(event)
  const { id } = await getValidatedRouterParams(event, Params.parse)
  const job = useJobs().get(id)
  if (!job || !canSeeJob(access, id))
    throw createError({ statusCode: 404, statusMessage: 'No such job.' })
  return job
})
