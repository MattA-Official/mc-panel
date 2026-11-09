import type { H3Event } from 'h3'
import { deriveSecret } from 'nuxt/server'
import { z } from 'zod'
import { join } from 'node:path'
import { ExportService } from '../backups/exports'
import { BackupScheduler } from '../backups/scheduler'
import { BackupError, BackupService } from '../backups/service'
import { OffsiteService, s3Store, sealer } from '../backups/offsite'
import { schema } from '../db'

let service: BackupService | undefined
let offsite: OffsiteService | undefined

/** The one off-site copier for this process. */
export function useOffsite(): OffsiteService {
  const seal = sealer(() => deriveSecret('flytower:backup-targets'))
  offsite ??= new OffsiteService({
    db: useDb(),
    store: s3Store,
    seal: seal.seal,
    unseal: seal.unseal,
    localPath: (row) => join(useRuntimeConfig().backupsDir, row.server, row.file),
    notifier: useNotify(),
  })
  return offsite
}
let exportService: ExportService | undefined
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
    offsite: useOffsite(),
    notifier: useNotify(),
  })
  return service
}

/** The one export service for this process. */
export function useExports(): ExportService {
  exportService ??= new ExportService({
    db: useDb(),
    exportsDir: useRuntimeConfig().exportsDir,
    serverDir,
    backups: useBackups(),
    jobs: useJobs(),
  })
  return exportService
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
    const missing = err.message.startsWith('No such')
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

const BackupParams = z.object({ name: z.string().max(40), id: z.coerce.number().int().optional() })

/** Streams a zip as a download with a readable, safe file name. */
export function zipResponse(path: string, filename: string) {
  const file = Bun.file(path)
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')
  return new Response(file, {
    headers: {
      'content-type': 'application/zip',
      'content-length': String(file.size),
      'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
    },
  })
}
