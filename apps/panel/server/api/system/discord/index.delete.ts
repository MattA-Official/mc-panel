/** Disconnects the app: takes its commands down on Discord where it can, then forgets it. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.integrations')
  const { user } = await requireElevated(event)
  const discord = useDiscord()
  const app = discord.app()
  const { cleanedUp } = await discord.disconnect()
  // Chat from Discord needs the app, so it closes too (the setting is kept for next time).
  syncDiscordGateway()
  if (app) {
    audit(user.id, 'discord.disconnect', null, {
      applicationId: app.applicationId,
      name: app.name,
      cleanedUp,
    })
  }
  return { ...discord.state(), cleanedUp }
})
