// Game chat to Discord: listens to every server's log lines (the log watcher is started by the
// notify plugin) and posts chat, joins and leaves for servers that have a channel webhook set.
export default defineNitroPlugin((nitro) => {
  useChatRelay()
  nitro.hooks.hook('close', async () => {
    await useChatRelay().idle()
  })
})
