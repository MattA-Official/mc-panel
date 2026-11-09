/**
 * Backups of one server folder, made and restored by the panel. Every server runs in the
 * panel's group with UMask=0007, so no root help is needed. All access to server folders
 * and the backups folder goes through here, so it can become agent verbs for remote
 * machines later (#29).
 */
import { lstat, mkdir, readdir, rm, stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { and, desc, eq } from 'drizzle-orm'
import { BACKUP_STEPS, RESTORE_STEPS, type JobEvent } from '../../shared/utils/jobs'
import { schema, type Db } from '../db'
import { JobError, type AgentCall, type JobTracker } from '../jobs/runner'
import { createArchive, EXCLUDE, extractArchive } from './archive'
import { toPrune } from './retention'

export type Backup = typeof schema.backups.$inferSelect
export type BackupKind = Backup['kind']

/** Shown to the user as-is. */
export class BackupError extends JobError {}

export const SAFETY_KEEP = 3
const FILE = /^[a-z][a-z0-9-]{1,30}-\d{8}T\d{6}Z(-[a-z]+)?\.tar\.zst$/

export interface BackupDeps {
  db: Db
  backupsDir: string
  serverDir: (name: string) => string
  agent: AgentCall
  jobs: {
    track(kind: string, server: string | null, steps: readonly string[]): JobTracker
    waitActive(name: string): Promise<void>
  }
  /** Runs an RCON command quietly. */
  rcon: (name: string, command: string, timeoutMs?: number) => Promise<string>
  /** Called once a server has stopped, to drop cached connections. */
  stopped?: (name: string) => void
  now?: () => Date
  freeBytes?: (dir: string) => Promise<number>
  sleep?: (ms: number) => Promise<void>
}

const stampOf = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')

export function formatBytes(n: number) {
  if (n < 1024 ** 2) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

const describeTime = (d: Date) =>
  `${d.toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC`

/** Bytes in a folder, skipping what backups skip and never following symlinks. */
export async function folderBytes(dir: string): Promise<number> {
  const skip = new Set(EXCLUDE.map((e) => e.slice(2)))
  let total = 0
  const walk = async (d: string, top: boolean) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (top && skip.has(e.name)) continue
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p, false)
      else if (e.isFile()) total += (await lstat(p)).size
    }
  }
  await walk(dir, true)
  return total
}

async function diskFree(dir: string) {
  const s = await statfs(dir)
  return s.bavail * s.bsize
}

export class BackupService {
  /** Servers with a backup or restore in flight. */
  private busy = new Set<string>()
  private now: () => Date
  private sleep: (ms: number) => Promise<void>

  constructor(private deps: BackupDeps) {
    this.now = deps.now ?? (() => new Date())
    this.sleep = deps.sleep ?? ((ms) => Bun.sleep(ms))
  }

  folder(server: string) {
    return join(this.deps.backupsDir, server)
  }

  isBusy(server: string) {
    return this.busy.has(server)
  }

  /**
   * Backups for a server, newest first. The folder is the truth: files without a row are
   * adopted (say, copied in by hand) and rows without a file are dropped.
   */
  async list(server: string): Promise<Backup[]> {
    const { db } = this.deps
    const dir = this.folder(server)
    const files = new Set(
      (await readdir(dir).catch(() => [] as string[])).filter((f) => FILE.test(f)),
    )
    const rows = db.select().from(schema.backups).where(eq(schema.backups.server, server)).all()
    for (const row of rows) {
      if (!files.has(row.file)) db.delete(schema.backups).where(eq(schema.backups.id, row.id)).run()
      files.delete(row.file)
    }
    for (const file of files) {
      const st = await stat(join(dir, file))
      db.insert(schema.backups)
        .values({ server, file, bytes: st.size, kind: 'manual', createdAt: st.mtime })
        .onConflictDoNothing()
        .run()
    }
    return db
      .select()
      .from(schema.backups)
      .where(eq(schema.backups.server, server))
      .orderBy(desc(schema.backups.createdAt), desc(schema.backups.id))
      .all()
  }

  get(server: string, id: number): Backup {
    const row = this.deps.db
      .select()
      .from(schema.backups)
      .where(and(eq(schema.backups.server, server), eq(schema.backups.id, id)))
      .get()
    if (!row) throw new BackupError('No such backup.')
    return row
  }

  path(row: Backup) {
    return join(this.folder(row.server), row.file)
  }

  async remove(server: string, id: number) {
    this.claim(server)
    try {
      const row = this.get(server, id)
      await rm(this.path(row), { force: true })
      this.deps.db.delete(schema.backups).where(eq(schema.backups.id, id)).run()
      return row
    } finally {
      this.busy.delete(server)
    }
  }

  /** Starts a backup job; refuses at once if the server is already busy. */
  backup(
    server: string,
    kind: Exclude<BackupKind, 'safety'>,
    note: string | null = null,
  ): { jobId: number; done: Promise<JobEvent> } {
    this.claim(server)
    const job = this.deps.jobs.track('server.backup', server, BACKUP_STEPS)
    const done = this.runBackup(server, kind, note, job)
      .then((row) => job.succeed(`Backed up ${formatBytes(row.bytes)}.`))
      .catch((err) => job.fail(err))
      .finally(() => this.busy.delete(server))
    return { jobId: job.id, done }
  }

  /** Starts a restore job. The caller has already checked a passkey. */
  restore(server: string, id: number): { jobId: number; done: Promise<JobEvent> } {
    const row = this.get(server, id)
    this.claim(server)
    const job = this.deps.jobs.track('server.restore', server, RESTORE_STEPS)
    const done = this.runRestore(row, job)
      .then(() => job.succeed(`Restored the backup taken ${describeTime(row.createdAt)}.`))
      .catch((err) => job.fail(err))
      .finally(() => this.busy.delete(server))
    return { jobId: job.id, done }
  }

  /** Deletes scheduled backups outside the server's retention, and old safety copies. */
  async prune(server: string): Promise<Backup[]> {
    const { db } = this.deps
    const settings = db
      .select({
        keepLast: schema.servers.keepLast,
        keepDaily: schema.servers.keepDaily,
        keepWeekly: schema.servers.keepWeekly,
      })
      .from(schema.servers)
      .where(eq(schema.servers.name, server))
      .get()
    if (!settings) return []
    const all = await this.list(server)
    const gone = [
      ...toPrune(
        all.filter((b) => b.kind === 'scheduled'),
        settings,
      ),
      ...all.filter((b) => b.kind === 'safety').slice(SAFETY_KEEP),
    ]
    for (const b of gone) {
      await rm(this.path(b), { force: true })
      db.delete(schema.backups).where(eq(schema.backups.id, b.id)).run()
    }
    return gone
  }

  private claim(server: string) {
    if (this.busy.has(server)) {
      throw new BackupError('A backup or restore is already running for this server.')
    }
    this.busy.add(server)
  }

  private async isRunning(server: string) {
    const { active } = await this.deps.agent('service.status', { server })
    return active === 'active' || active === 'activating'
  }

  /** Archives the folder into a new backup file and records it. */
  private async archive(server: string, kind: BackupKind, note: string | null) {
    const dir = this.folder(server)
    await mkdir(dir, { recursive: true, mode: 0o750 })
    const createdAt = this.now()
    const file = `${server}-${stampOf(createdAt)}-${kind}.tar.zst`
    const { bytes } = await createArchive(this.deps.serverDir(server), join(dir, file))
    return this.deps.db
      .insert(schema.backups)
      .values({ server, file, bytes, kind, note, createdAt })
      .returning()
      .get()
  }

  private async checkSpace(server: string) {
    const dir = this.folder(server)
    await mkdir(dir, { recursive: true, mode: 0o750 })
    const need = await folderBytes(this.deps.serverDir(server))
    const free = await (this.deps.freeBytes ?? diskFree)(dir)
    // zstd usually shrinks a world 2-4x; ask for the uncompressed size to be safe.
    if (free < need * 1.1) {
      throw new BackupError(
        `Not enough disk space: the server is ${formatBytes(need)} and only ${formatBytes(free)} is free.`,
      )
    }
    return need
  }

  private async runBackup(server: string, kind: BackupKind, note: string | null, job: JobTracker) {
    const { rcon } = this.deps
    job.step(0)
    const size = await this.checkSpace(server)

    const running = await this.isRunning(server)
    job.step(1, running ? 'Pausing autosave and flushing to disk' : 'The server is stopped')
    let paused = false
    try {
      if (running) {
        await rcon(server, 'save-off')
        paused = true
        const reply = await rcon(server, 'save-all flush', 5 * 60_000)
        if (!/saved the game/i.test(reply)) {
          throw new BackupError(`The server didn't confirm the save: ${reply || 'no reply'}`)
        }
      }
      job.step(2, `About ${formatBytes(size)} before compression`)
      return await this.archive(server, kind, note)
    } finally {
      if (paused) {
        await rcon(server, 'save-on').catch((err) =>
          console.error(`[flytower] couldn't turn saving back on for ${server}`, err),
        )
      }
      job.step(3)
      await this.prune(server).catch((err) =>
        console.error(`[flytower] pruning backups for ${server} failed`, err),
      )
    }
  }

  private async waitStopped(server: string) {
    for (let i = 0; i < 180; i++) {
      const { active } = await this.deps.agent('service.status', { server })
      if (active === 'inactive' || active === 'failed') return
      await this.sleep(1000)
    }
    throw new BackupError('The server took too long to stop.')
  }

  private async emptyFolder(dir: string) {
    for (const name of await readdir(dir)) {
      await rm(join(dir, name), { recursive: true, force: true })
    }
  }

  private async runRestore(row: Backup, job: JobTracker) {
    const { agent } = this.deps
    const server = row.server
    const dir = this.deps.serverDir(server)

    job.step(0)
    const wasRunning = await this.isRunning(server)
    if (wasRunning) {
      await agent('service.stop', { server }, { timeoutMs: 180_000 })
      await this.waitStopped(server)
    }
    this.deps.stopped?.(server)

    job.step(1)
    await this.checkSpace(server)
    const safety = await this.archive(server, 'safety', `Before restoring ${row.file}`)

    job.step(2)
    try {
      await this.emptyFolder(dir)
      await extractArchive(this.path(row), dir)
    } catch (err) {
      // Put things back as they were.
      await this.emptyFolder(dir)
      await extractArchive(this.path(safety), dir)
      throw err
    }
    await this.prune(server)

    if (wasRunning) {
      job.step(3)
      await agent('service.start', { server })
      await this.deps.jobs.waitActive(server)
    }
  }
}
