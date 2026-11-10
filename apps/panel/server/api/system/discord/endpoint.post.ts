/** Tries again to point the app's interactions endpoint at this panel. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.manage')
  const discord = useDiscord()
  if (!discord.app()) {
    throw createError({ statusCode: 404, statusMessage: 'No Discord app is connected.' })
  }
  await discord.pointEndpoint()
  return discord.state()
})
