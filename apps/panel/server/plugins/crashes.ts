// Crash detection: polls every server's state in the background, every ten seconds, so a
// crash is noticed (inside systemd's 15-second restart delay) with no browser open.
export default defineNitroPlugin((nitro) => {
  const status = useStatus()
  status.background(10_000)
  nitro.hooks.hook('close', () => status.stopBackground())
})
