// Player sessions from every server's log (after notify, which starts the log watcher), and
// once at boot, lining up sessions left open with who is on now.
export default defineNitroPlugin((nitro) => {
  useSessions()
  // Give servers and their consoles a moment after a panel restart before asking who's on.
  const t = setTimeout(() => {
    reconcileSessions().catch((err) =>
      console.error('[flytower] matching player sessions at boot failed', err),
    )
  }, 15_000)
  t.unref?.()
  nitro.hooks.hook('close', async () => {
    clearTimeout(t)
    await useSessions().idle()
  })
})
