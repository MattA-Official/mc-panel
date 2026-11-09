import { z } from 'zod'

const Body = z.object({ planId: z.string().regex(/^[a-f0-9]{24}$/) })

/** Applies a plan made a moment ago, as a job. */
export default defineEventHandler(async (event) => {
  const { user, name, specs } = await specContext(event)
  const { planId } = await readValidatedBody(event, Body.parse)
  const { jobId } = await specHttp(() => specs.apply(name, planId))
  audit(user.id, 'server.apply', name, { planId, jobId })
  return { jobId }
})
