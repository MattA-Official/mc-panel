import { diskLevel } from '../../../../shared/disk'

/**
 * How full the disk is and where the space has gone: each server's last measurement and the
 * shared imports and archive folders. Reads what the background walk last found, so it's quick.
 */
export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const fullness = diskFullness()
  return { ...fullness, level: diskLevel(fullness.percent), ...useDiskUsage().current() }
})
