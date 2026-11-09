// Notifications: follows server logs for joins and leaves if a channel wants them, and checks
// for new versions of Flytower and installed content every six hours. Runs after db.
export default defineNitroPlugin((nitro) => {
  syncPlayerWatcher()
  const check = () =>
    void checkUpdatesForNotify().catch((err) =>
      console.error('[flytower] update check for notifications failed', err),
    )
  const first = setTimeout(check, 5 * 60_000)
  const timer = setInterval(check, 6 * 3600_000)
  nitro.hooks.hook('close', async () => {
    clearTimeout(first)
    clearInterval(timer)
    usePlayerWatcher().stop()
    await useNotify().idle()
  })
})
