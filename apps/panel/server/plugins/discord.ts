// Discord: an update may have changed the slash commands, so send the list again if it
// differs from what Discord last accepted. Then open the Gateway if chat from Discord is on.
// Runs after db.
export default defineNitroPlugin((nitro) => {
  void syncDiscordCommands()
  syncDiscordGateway()
  nitro.hooks.hook('close', async () => {
    useDiscordGateway().stop()
    await useDiscordToGame().idle()
  })
})
