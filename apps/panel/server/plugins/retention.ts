import { pruneOld } from '../db/retention'

// Old activity entries and finished jobs, cleared at boot and every night at 04:17 (after db).
export default defineNitroPlugin((nitro) => {
  const run = () => {
    try {
      const { audit, jobs } = pruneOld(useDb())
      if (audit || jobs)
        console.log(`[flytower] cleared ${audit} old activity entries and ${jobs} old jobs`)
    } catch (err) {
      console.error('[flytower] clearing old activity and jobs failed', err)
    }
  }
  run()
  const cron = Bun.cron('17 4 * * *', run)
  cron.unref()
  nitro.hooks.hook('close', () => cron.stop())
})
