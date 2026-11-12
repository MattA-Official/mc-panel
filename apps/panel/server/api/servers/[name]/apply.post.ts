import { z } from 'zod'

const Body = z.object({ planId: z.string().regex(/^[a-f0-9]{24}$/) })

/**
 * Applies a plan made a moment ago, as a job. The plan knows which parts of the spec it
 * changes, and the permissions for them are checked again here.
 */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.view')
  const { user, name, specs } = await specContext(event)
  const { planId } = await readValidatedBody(event, Body.parse)
  const needs = specs.planNeeds(name, planId)
  if (needs) requireSpecChange(event, name, needs)
  const { jobId } = await specHttp(() => specs.apply(name, planId))
  audit(user.id, 'server.apply', name, { planId, jobId })
  return { jobId }
})
