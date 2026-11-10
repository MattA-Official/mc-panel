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
    backups: await Promise.all(
      backups.map(async (b) => ({
        id: b.id,
        file: b.file,
        bytes: b.bytes,
        kind: b.kind,
        note: b.note,
        kept: b.kept,
        createdAt: b.createdAt,
        local: await Bun.file(service.path(b)).exists(),
        offsite: b.offsiteState
          ? { state: b.offsiteState, error: b.offsiteError, at: b.offsiteAt }
          : null,
      })),
    ),
    offsiteTarget: server.offsiteTarget,
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
