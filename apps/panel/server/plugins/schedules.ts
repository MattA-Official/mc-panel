// Runs after db and jobs (alphabetical).
export default defineNitroPlugin(() => {
  syncBackupSchedules()
  // Expired world exports are deleted hourly, and once at boot.
  const sweep = () =>
    void useExports()
      .sweep()
      .catch((err) => console.error('[flytower] sweeping exports failed', err))
  sweep()
  Bun.cron('7 * * * *', sweep).unref()
})
