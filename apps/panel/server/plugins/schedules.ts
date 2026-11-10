// Runs after db and jobs (alphabetical).
export default defineNitroPlugin(() => {
  syncBackupSchedules()
  useSchedules().sync()
  // Expired world exports are deleted hourly, and once at boot.
  const sweep = () =>
    void useExports()
      .sweep()
      .catch((err) => console.error('[flytower] sweeping exports failed', err))
  const sweepImports = () =>
    void useImports()
      .sweep()
      .catch((err) => console.error('[flytower] sweeping imports failed', err))
  sweep()
  sweepImports()
  Bun.cron('7 * * * *', () => {
    sweep()
    sweepImports()
  }).unref()
})
