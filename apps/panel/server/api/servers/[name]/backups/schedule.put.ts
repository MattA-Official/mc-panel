import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { nextRun } from '../../../../backups/scheduler'
import { schema } from '../../../../db'

const Body = z.object({
  cron: z.string().trim().max(100).nullable(),
  tz: z.string().max(64),
  keepLast: z.number().int().min(0).max(1000),
  keepDaily: z.number().int().min(0).max(366),
  keepWeekly: z.number().int().min(0).max(520),
})

/** Sets the backup schedule and retention. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.configure')
  const { user, name } = await backupContext(event)
  const body = await readValidatedBody(event, Body.parse)
  const cron = body.cron || null
  let next: Date | null
  try {
    next = cron ? nextRun(cron, body.tz) : null
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: (err as Error).message })
  }
  if (cron && body.keepLast + body.keepDaily + body.keepWeekly === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Keep at least one scheduled backup.' })
  }
  useDb()
    .update(schema.servers)
    .set({
      backupSchedule: cron,
      backupTz: body.tz,
      keepLast: body.keepLast,
      keepDaily: body.keepDaily,
      keepWeekly: body.keepWeekly,
    })
    .where(eq(schema.servers.name, name))
    .run()
  syncBackupSchedules()
  audit(user.id, 'backup.schedule', name, { ...body, cron })
  return { next }
})
