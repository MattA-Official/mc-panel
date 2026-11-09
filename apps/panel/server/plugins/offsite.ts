// Picks up off-site uploads cut off by a restart, then sweeps for retries every 15 minutes.
export default defineNitroPlugin((nitro) => {
  const offsite = useOffsite()
  const sweep = () =>
    void offsite.sweep().catch((err) => console.error('[flytower] off-site sweep failed', err))
  const first = setTimeout(sweep, 30_000)
  const timer = setInterval(sweep, 15 * 60_000)
  nitro.hooks.hook('close', () => {
    clearTimeout(first)
    clearInterval(timer)
    offsite.stop()
  })
})
