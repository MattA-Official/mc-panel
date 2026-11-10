// Crash detection: follows systemd's journal through the agent, so a crash is noticed as it
// happens with no browser open and nothing polled. See StatusWatcher.follow.
export default defineNitroPlugin((nitro) => {
  const status = useStatus()
  status.follow()
  nitro.hooks.hook('close', () => status.unfollow())
})
