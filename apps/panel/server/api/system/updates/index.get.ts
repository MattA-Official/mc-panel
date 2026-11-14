import { z } from 'zod'
import { getSetting } from '../../../settings'
import { compareVersions, newestRelease, updateChannel } from '../../../updates'

const Query = z.object({ check: z.stringbool().default(false) })

/** What's running, what's installed, what's newer on the chosen channel, and how the last update went. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.updates')
  const { check } = await getValidatedQuery(event, Query.parse)
  const status = await agent('update.status', {}).catch(() => null)
  const current = status?.current ?? useRuntimeConfig().version
  const { channel, retired } = updateChannel(getSetting(useDb(), 'update.channel'), current)
  let latest = null
  let checkError: string | null = null
  try {
    const newest = await newestRelease(channel, check)
    if (newest && compareVersions(newest.version, current) > 0) latest = newest
    // Keep the System badge in step with what this page shows.
    useUpdates().store('flytower', '*', {
      current,
      latest: latest && {
        version: latest.version,
        prerelease: latest.prerelease,
        url: latest.url,
      },
    })
  } catch (err) {
    checkError = `Couldn't check for updates: ${(err as Error).message}`
  }
  return {
    current,
    channel,
    /** Still on the Native channel, which ended in 1.5.0: say so until someone chooses again. */
    nativeRetired: retired,
    installed: status?.releases ?? [],
    last: status?.last ?? null,
    latest,
    checkError,
  }
})
