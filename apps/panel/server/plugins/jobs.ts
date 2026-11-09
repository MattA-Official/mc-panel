// Runs after the db plugin (alphabetical). Nothing can be running at boot, so any job left
// mid-flight was cut off by a restart.
export default defineNitroPlugin(() => {
  const cut = useJobs().recover()
  if (cut) console.log(`[flytower] marked ${cut} interrupted job(s) as failed`)
})
