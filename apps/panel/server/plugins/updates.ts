import { CHECK_EVERY_MS, checkCron } from '../update-checks'

// The background update check: every six hours at a random minute and hour offset, and five
// minutes after starting if the last check is older than that. Opening the panel can also
// start one (see the `updates` WebSocket topic). Runs after notify, which tells people.
export default defineNitroPlugin((nitro) => {
  const updates = useUpdates()
  const run = () =>
    void updates.checkAll().catch((err) => console.error('[flytower] update check failed', err))
  // Just updated (or rolled back): what's on offer has changed, so ask again now.
  const known = updates.snapshot().flytower?.summary?.current
  if (known && known !== useRuntimeConfig().version) {
    void updates.record('flytower', '*', () => checkFlytower(false))
  }
  const first = setTimeout(() => updates.maybeCheck(CHECK_EVERY_MS), 5 * 60_000)
  const cron = Bun.cron(checkCron(), run)
  cron.unref()
  nitro.hooks.hook('close', () => {
    clearTimeout(first)
    cron.stop()
  })
})
