import { schema } from '../../../db'
import { diskLevel } from '../../../../shared/disk'

/**
 * How full the disk is and where the space has gone: each server's last measurement and the
 * shared imports and archive folders. Reads what the background walk last found, so it's quick.
 */
export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const fullness = diskFullness()
  const report = useDiskUsage().current()
  const names = new Map(
    useDb()
      .select({ name: schema.servers.name, displayName: schema.servers.displayName })
      .from(schema.servers)
      .all()
      .map((r) => [r.name, r.displayName]),
  )
  return {
    ...fullness,
    level: diskLevel(fullness.percent),
    ...report,
    servers: report.servers.map((s) => ({ ...s, displayName: names.get(s.server) ?? s.server })),
  }
})
