// Runs after db and jobs (alphabetical).
export default defineNitroPlugin(() => {
  syncBackupSchedules()
})
