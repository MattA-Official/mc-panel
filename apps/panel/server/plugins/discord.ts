// Discord: an update may have changed the slash commands, so send the list again if it
// differs from what Discord last accepted. Runs after db.
export default defineNitroPlugin(() => {
  void syncDiscordCommands()
})
