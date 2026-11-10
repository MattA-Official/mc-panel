/** Back to Flytower's own name, colours, font and logo. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.manage')
  const { user } = await requireElevated(event)
  useBranding().reset()
  audit(user.id, 'branding.reset', null)
  return useBranding().public()
})
