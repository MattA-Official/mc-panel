/** The Discord app connection, without the bot token. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.manage')
  return useDiscord().state()
})
