import { z } from 'zod'

const Params = z.object({ slot: z.enum(['logo', 'favicon']) })

/** Removes the uploaded logo or favicon, going back to Flytower's. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.branding')
  const { user } = await requireElevated(event)
  const { slot } = await getValidatedRouterParams(event, Params.parse)
  useBranding().removeImage(slot)
  audit(user.id, `branding.${slot}.remove`, null)
  return useBranding().public()
})
