// Disk use: measures every server in the background now and hourly, and again for a server
// whenever one of its jobs finishes (a backup, restore, import, world reset and so on), so
// the figures follow what happens rather than being polled.
export default defineNitroPlugin((nitro) => {
  const disk = useDiskUsage()
  disk.start()
  const off = useJobs().bus.subscribe('jobs:finished', (message) => {
    const job = message as { server: string | null }
    void disk.refresh(job.server)
  })
  nitro.hooks.hook('close', () => {
    off()
    disk.stop()
  })
})
