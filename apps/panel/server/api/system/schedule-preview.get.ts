import { z } from 'zod'
import { nextRun } from '../../backups/scheduler'

const Query = z.object({
  cron: z.string().trim().min(1).max(100),
  tz: z.string().max(64),
})

/**
 * The next few times a cron expression would run, so a schedule can be checked before it's
 * saved. Uses the same reading as the backup scheduler.
 */
export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const { cron, tz } = await getValidatedQuery(event, Query.parse)
  const next: string[] = []
  let from = new Date()
  try {
    for (let i = 0; i < 3; i++) {
      const at = nextRun(cron, tz, from)
      if (!at) break
      next.push(at.toISOString())
      from = new Date(at.getTime() + 1000)
    }
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: (err as Error).message })
  }
  return { next }
})
