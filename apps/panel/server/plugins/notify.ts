// Notifications: follows every server's log (through inotify, so no polling) for starts,
// stops, restarts, joins and leaves, and checks for new versions of Flytower and installed
// content every six hours. Runs after db.
export default defineNitroPlugin((nitro) => {
  syncLogWatcher()
  const check = () =>
    void checkUpdatesForNotify().catch((err) =>
      console.error('[flytower] update check for notifications failed', err),
    )
  const first = setTimeout(check, 5 * 60_000)
  const timer = setInterval(check, 6 * 3600_000)
  nitro.hooks.hook('close', async () => {
    clearTimeout(first)
    clearInterval(timer)
    useLogWatcher().stop()
    await useNotify().idle()
  })
})
