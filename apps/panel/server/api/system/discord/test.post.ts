/** Checks the stored token still works for the same app, and refreshes what the card shows. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.integrations')
  const discord = useDiscord()
  await discordHttp(() => discord.test())
  return discord.state()
})
