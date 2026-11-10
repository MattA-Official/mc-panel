/** Sends the slash commands to Discord again, for when the last try failed. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.manage')
  const discord = useDiscord()
  if (!discord.app()) {
    throw createError({ statusCode: 404, statusMessage: 'No Discord app is connected.' })
  }
  await syncDiscordCommands(true)
  return discord.state()
})
