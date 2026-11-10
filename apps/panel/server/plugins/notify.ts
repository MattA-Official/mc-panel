// Notifications: follows every server's log (through inotify, so no polling) for starts,
// stops, restarts, joins and leaves. Update notices come from the update check (updates.ts).
// Runs after db.
export default defineNitroPlugin((nitro) => {
  syncLogWatcher()
  nitro.hooks.hook('close', async () => {
    useLogWatcher().stop()
    await useNotify().idle()
  })
})
