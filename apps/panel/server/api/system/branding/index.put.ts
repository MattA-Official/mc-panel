/** Saves the name, accent colour, display font and the "Powered by Flytower" switch. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.branding')
  const { user } = await requireElevated(event)
  const body = await readBody(event)
  const saved = brandingHttp(() => useBranding().save(body))
  audit(user.id, 'branding.update', null, saved)
  return useBranding().public()
})
