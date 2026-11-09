import type { H3Event } from 'h3'
import { z } from 'zod'
import { BackupScheduler } from '../backups/scheduler'
import { BackupError, BackupService } from '../backups/service'
import { schema } from '../db'

let service: BackupService | undefined
let scheduler: BackupScheduler | undefined

/** The one backup service for this process. */
export function useBackups(): BackupService {
  service ??= new BackupService({
    db: useDb(),
    backupsDir: useRuntimeConfig().backupsDir,
    serverDir,
    agent,
    jobs: useJobs(),
    rcon: (name, command, timeoutMs) =>
      useConsole().command(name, command, { echo: false, timeoutMs }),
    stopped: (name) => useConsole().forget(name),
  })
  return service
}

/** Re-reads every server's schedule and updates the cron jobs. */
export function syncBackupSchedules() {
  scheduler ??= new BackupScheduler(useBackups())
  scheduler.sync(
    useDb()
      .select({
        name: schema.servers.name,
        backupSchedule: schema.servers.backupSchedule,
        backupTz: schema.servers.backupTz,
      })
      .from(schema.servers)
      .all(),
  )
}

/** Signed in, a real server, and BackupErrors turned into HTTP errors. */
export async function backupContext(event: H3Event) {
  const { user } = await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, BackupParams.parse)
  findServer(name)
  return { user, name, service: useBackups() }
}

function toHttp(err: unknown): never {
  if (err instanceof BackupError) {
    const missing = err.message === 'No such backup.'
    throw createError({ statusCode: missing ? 404 : 409, statusMessage: err.message })
  }
  throw err
}

/** Runs `fn`, turning a BackupError (thrown or rejected) into a 404 or 409. */
export function backupHttp<T>(fn: () => T): T {
  try {
    const out = fn()
    return (out instanceof Promise ? out.catch(toHttp) : out) as T
  } catch (err) {
    return toHttp(err)
  }
}

export function audit(userId: number, action: string, target: string, detail?: object) {
  useDb()
    .insert(schema.audit)
    .values({ userId, action, target, detail: detail as Record<string, unknown> })
    .run()
}

const BackupParams = z.object({ name: z.string().max(40), id: z.coerce.number().int().optional() })
