import { nextRun } from '../../../../backups/scheduler'

/** Backups for a server, its schedule and whether something is running now. */
export default defineEventHandler(async (event) => {
  const { name, service } = await backupContext(event)
  const server = findServer(name)
  const backups = await service.list(name)
  let next: Date | null = null
  try {
    next = server.backupSchedule ? nextRun(server.backupSchedule, server.backupTz) : null
  } catch {
    // A schedule saved before a Bun upgrade changed parsing; show it without a next run.
  }
  return {
    backups: backups.map(({ id, file, bytes, kind, note, createdAt }) => ({
      id,
      file,
      bytes,
      kind,
      note,
      createdAt,
    })),
    schedule: {
      cron: server.backupSchedule,
      tz: server.backupTz,
      keepLast: server.keepLast,
      keepDaily: server.keepDaily,
      keepWeekly: server.keepWeekly,
      next,
    },
    busy: service.isBusy(name),
  }
})
