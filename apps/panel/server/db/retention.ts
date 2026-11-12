/**
 * How long the tables that only ever grow are kept. Metrics, crash events and player stats
 * prune themselves; these are the rest. Runs at boot and once a day.
 */
import { and, eq, isNotNull, isNull, lt, ne, or } from 'drizzle-orm'
import { schema, type Db } from '.'

const DAY = 24 * 3600_000

/** Activity entries for things people did. */
export const AUDIT_KEEP_MS = 365 * DAY
/** Scheduled tasks run by the panel itself log every run, so they go sooner. */
export const SCHEDULE_RUN_KEEP_MS = 90 * DAY
/** Finished jobs (creating, importing, cloning servers): only recent ones are worth showing. */
export const JOBS_KEEP_MS = 30 * DAY

export function pruneOld(db: Db, now = Date.now()): { audit: number; jobs: number } {
  const a = schema.audit
  const audit = db
    .delete(a)
    .where(
      or(
        lt(a.at, new Date(now - AUDIT_KEEP_MS)),
        and(
          eq(a.action, 'schedule.run'),
          isNull(a.userId),
          lt(a.at, new Date(now - SCHEDULE_RUN_KEEP_MS)),
        ),
      ),
    )
    .run().changes
  const j = schema.jobs
  // Queued and running jobs are never removed, however old.
  const jobs = db
    .delete(j)
    .where(
      and(
        ne(j.state, 'queued'),
        ne(j.state, 'running'),
        isNotNull(j.finishedAt),
        lt(j.finishedAt, new Date(now - JOBS_KEEP_MS)),
      ),
    )
    .run().changes
  return { audit, jobs }
}
