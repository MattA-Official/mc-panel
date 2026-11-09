import { z } from 'zod'
import { compareVersions, newestRelease } from '../../../updates'

const Query = z.object({ check: z.stringbool().default(false) })

/** What's running, what's installed, what's newer, and how the last update went. */
export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const { check } = await getValidatedQuery(event, Query.parse)
  const status = await agent('update.status', {}).catch(() => null)
  const current = status?.current ?? useRuntimeConfig().version
  let latest = null
  let checkError: string | null = null
  try {
    const newest = await newestRelease(check)
    if (newest && compareVersions(newest.version, current) > 0) latest = newest
  } catch (err) {
    checkError = `Couldn't check for updates: ${(err as Error).message}`
  }
  return {
    current,
    installed: status?.releases ?? [],
    last: status?.last ?? null,
    latest,
    checkError,
  }
})
