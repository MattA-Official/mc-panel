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
import { createArchive, extractArchive, isExcluded } from './archive'
import { toPrune } from './retention'
import type { Notifier } from '../notify/types'
import { DISK_URGENT } from '../../shared/disk'

export type Backup = typeof schema.backups.$inferSelect
export type BackupKind = Backup['kind']

/** Shown to the user as-is. */
export class BackupError extends JobError {}

/** A scheduled backup that didn't start because the disk is nearly full. */
export class BackupSkipped extends BackupError {}

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
  /** Off-site copies, when set up. */
  offsite?: {
    queue(row: Backup): void
    removeCopy(row: Backup): Promise<void>
    fetch(row: Backup): Promise<void>
  }
  /** Tells people when a backup fails, and when backups work again. */
  notifier?: Notifier
  /** How full the servers' disk is, in percent, or null if unknown. */
  diskPercent?: () => number | null
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
  let total = 0
  const walk = async (d: string, rel: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (isExcluded(r)) continue
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p, r)
      else if (e.isFile()) total += (await lstat(p)).size
    }
  }
  await walk(dir, '')
  return total
}

/** A sentence on files a backup had to leave out, or nothing. */
export function describeSkipped(skipped: string[]) {
  if (!skipped.length) return ''
  const shown = skipped.slice(0, 3).join(', ')
  const more = skipped.length > 3 ? ` and ${skipped.length - 3} more` : ''
  const files = skipped.length === 1 ? 'file' : 'files'
  return ` Left out ${skipped.length} ${files} Flytower couldn't read: ${shown}${more}.`
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

  /** Backup files being written, so a listing meanwhile doesn't take them for manual ones. */
  private writing = new Set<string>()

  /** Waiting for a server's lock to be let go, by server. */
  private waiters = new Map<string, Set<() => void>>()

  /** Resolves when nothing holds the server's lock (straight away if nothing does). */
  whenFree(server: string): Promise<void> {
    if (!this.busy.has(server)) return Promise.resolve()
    return new Promise((resolve) => {
      let set = this.waiters.get(server)
      if (!set) this.waiters.set(server, (set = new Set()))
      set.add(resolve)
    })
  }

  private free(server: string) {
    this.busy.delete(server)
    const set = this.waiters.get(server)
    this.waiters.delete(server)
    for (const resolve of set ?? []) resolve()
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
      // Gone from disk: kept if there's an off-site copy to restore from, dropped if not.
      if (!files.has(row.file) && row.offsiteState !== 'done') {
        db.delete(schema.backups).where(eq(schema.backups.id, row.id)).run()
      }
      files.delete(row.file)
    }
    for (const file of files) {
      // One being written right now gets its row from archive(), not from here.
      if (this.writing.has(join(dir, file))) continue
      const st = await stat(join(dir, file)).catch(() => null)
      if (!st) continue
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
      // The row as it is now: an upload may have finished while the file was being removed.
      const latest = this.deps.db
        .delete(schema.backups)
        .where(eq(schema.backups.id, id))
        .returning()
        .get()
      await this.deps.offsite?.removeCopy(latest ?? row)
      return row
    } finally {
      this.free(server)
    }
  }

  /** Keeps a backup forever, or lets retention delete it again. */
  setKept(server: string, id: number, kept: boolean): Backup {
    this.get(server, id)
    return this.deps.db
      .update(schema.backups)
      .set({ kept })
      .where(eq(schema.backups.id, id))
      .returning()
      .get()!
  }

  /** Starts a backup job; refuses at once if the server is already busy. */
  backup(
    server: string,
    kind: Exclude<BackupKind, 'safety'>,
    note: string | null = null,
  ): { jobId: number; done: Promise<JobEvent> } {
    this.claim(server)
    const job = this.deps.jobs.track('server.backup', server, BACKUP_STEPS)
    const what = kind === 'scheduled' ? 'scheduled backup' : 'backup'
    const done = this.runBackup(server, kind, note, job)
      .then((row) => {
        this.deps.notifier?.resolve({
          kind: 'backup.failed',
          server,
          title: 'Backups are working again',
          detail: `A ${what} just finished (${formatBytes(row.bytes)}).`,
          severity: 'ok',
          link: `/servers/${server}/world#backups`,
        })
        return job.succeed(`Backed up ${formatBytes(row.bytes)}.${describeSkipped(row.skipped)}`)
      })
      .catch((err) => {
        const failed = job.fail(err)
        this.deps.notifier?.notify({
          kind: 'backup.failed',
          server,
          title: err instanceof BackupSkipped ? `A ${what} was skipped` : `A ${what} failed`,
          detail: failed.message ?? undefined,
          severity: 'critical',
          link: `/servers/${server}/world#backups`,
        })
        return failed
      })
      .finally(() => this.free(server))
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
      .finally(() => this.free(server))
    return { jobId: job.id, done }
  }

  /**
   * Deletes scheduled backups outside the server's retention, and old safety copies. Kept
   * backups are never deleted, and don't count towards either.
   */
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
    const all = (await this.list(server)).filter((b) => !b.kept)
    const gone = [
      ...toPrune(
        all.filter((b) => b.kind === 'scheduled'),
        settings,
      ),
      ...all.filter((b) => b.kind === 'safety').slice(SAFETY_KEEP),
    ]
    for (const b of gone) {
      await rm(this.path(b), { force: true })
      const latest = db.delete(schema.backups).where(eq(schema.backups.id, b.id)).returning().get()
      await this.deps.offsite?.removeCopy(latest ?? b)
    }
    return gone
  }

  private claim(server: string) {
    if (this.busy.has(server)) {
      throw new BackupError(
        'A backup, restore, change or scheduled restart is already running on this server.',
      )
    }
    this.busy.add(server)
  }

  private async isRunning(server: string) {
    const { active } = await this.deps.agent('service.status', { server })
    return active === 'active' || active === 'activating'
  }

  /** Archives the folder into a new backup file and records it. */
  private async archive(server: string, kind: BackupKind, note: string | null, kept = false) {
    const dir = this.folder(server)
    await mkdir(dir, { recursive: true, mode: 0o750 })
    // Names have one-second resolution; two backups in the same second take the next free one.
    let createdAt = this.now()
    const taken = new Set(await readdir(dir).catch(() => [] as string[]))
    while (taken.has(`${server}-${stampOf(createdAt)}-${kind}.tar.zst`)) {
      createdAt = new Date(createdAt.getTime() + 1000)
    }
    const file = `${server}-${stampOf(createdAt)}-${kind}.tar.zst`
    const dest = join(dir, file)
    this.writing.add(dest)
    let result: Awaited<ReturnType<typeof createArchive>>
    try {
      result = await createArchive(this.deps.serverDir(server), dest)
    } catch (err) {
      this.writing.delete(dest)
      throw err
    }
    const { bytes, skipped } = result
    if (skipped.length) {
      console.warn(
        `[flytower] backup ${file} left out files it couldn't read: ${skipped.join(', ')}`,
      )
    }
    const row = this.deps.db
      .insert(schema.backups)
      .values({ server, file, bytes, kind, note, createdAt, kept })
      .returning()
      .get()
    this.writing.delete(dest)
    this.deps.offsite?.queue(row)
    return Object.assign(row, { skipped })
  }

  private async checkSpace(server: string) {
    const need = await folderBytes(this.deps.serverDir(server))
    await this.ensureSpace(this.folder(server), need)
    return need
  }

  /**
   * Runs `fn` with the world flushed to disk and autosave paused, if the server is running,
   * and always turns autosave back on. `onRunning` hears whether it was running.
   */
  async withSavesPaused<T>(
    server: string,
    onRunning: (running: boolean) => void,
    fn: () => Promise<T>,
  ): Promise<T> {
    const { rcon } = this.deps
    const running = await this.isRunning(server)
    onRunning(running)
    let paused = false
    try {
      if (running) {
        await this.saveOffWhenReady(server)
        paused = true
        const reply = await rcon(server, 'save-all flush', 5 * 60_000)
        if (!/saved the game/i.test(reply)) {
          throw new BackupError(`The server didn't confirm the save: ${reply || 'no reply'}`)
        }
      }
      // Minecraft writes level.dat and others as 0600; let the panel's group read them.
      await this.deps.agent('server.permissions', { name: server }, { timeoutMs: 120_000 })
      return await fn()
    } finally {
      if (paused) {
        await rcon(server, 'save-on').catch((err) =>
          console.error(`[flytower] couldn't turn saving back on for ${server}`, err),
        )
      }
    }
  }

  /**
   * Turns autosave off. A server that has only just started has no RCON until its world
   * has loaded, so connection failures are retried for a while.
   */
  private async saveOffWhenReady(server: string) {
    const sleep = this.deps.sleep ?? ((ms: number) => Bun.sleep(ms))
    for (let i = 0; ; i++) {
      try {
        await this.deps.rcon(server, 'save-off')
        return
      } catch (err) {
        const starting = /connect|ECONNREFUSED|closed/i.test((err as Error).message)
        if (!starting || i >= 60 || !(await this.isRunning(server))) throw err
        await sleep(2000)
      }
    }
  }

  /**
   * A safety backup taken inside another job that already holds the server's lock, e.g.
   * before applying a spec. Saving is paused around it as usual. A kept one is never pruned.
   */
  async snapshot(server: string, note: string, opts: { kept?: boolean } = {}): Promise<Backup> {
    await this.checkSpace(server)
    const row = await this.withSavesPaused(
      server,
      () => {},
      () => this.archive(server, 'safety', note, opts.kept),
    )
    await this.prune(server).catch((err) =>
      console.error(`[flytower] pruning backups for ${server} failed`, err),
    )
    return row
  }

  /** Takes the per-server lock for an outside operation; call `release` when done. */
  lock(server: string) {
    this.claim(server)
    return () => this.free(server)
  }

  /** Throws unless there is room for `bytes` more on the disk holding `dir`. */
  async ensureSpace(dir: string, bytes: number) {
    await mkdir(dir, { recursive: true, mode: 0o750 })
    const free = await (this.deps.freeBytes ?? diskFree)(dir)
    // zstd and deflate usually shrink a world 2-4x; ask for the full size to be safe.
    if (free < bytes * 1.1) {
      throw new BackupError(
        `Not enough disk space: this needs up to ${formatBytes(bytes)} and only ${formatBytes(free)} is free.`,
      )
    }
  }

  private async runBackup(server: string, kind: BackupKind, note: string | null, job: JobTracker) {
    job.step(0)
    // Starting a big archive on a nearly full disk risks filling it mid-save, which can
    // corrupt the world. A person can still back up by hand once they've been warned.
    const pct = kind === 'scheduled' ? (this.deps.diskPercent?.() ?? null) : null
    if (pct !== null && pct >= DISK_URGENT) {
      throw new BackupSkipped(
        `Skipped: the disk is ${Math.round(pct)}% full, so this scheduled backup didn't start. Free up some space (old backups and world exports are the usual culprits) and the next one will run as normal.`,
      )
    }
    const size = await this.checkSpace(server)
    try {
      return await this.withSavesPaused(
        server,
        (running) =>
          job.step(1, running ? 'Pausing autosave and flushing to disk' : 'The server is stopped'),
        async () => {
          job.step(2, `About ${formatBytes(size)} before compression`)
          return this.archive(server, kind, note)
        },
      )
    } finally {
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
    // Only an off-site copy left: bring it back first.
    if (!(await Bun.file(this.path(row)).exists())) {
      if (!this.deps.offsite) throw new BackupError("This backup's file is missing.")
      job.step(1, 'Downloading the off-site copy')
      await this.deps.offsite.fetch(row)
    }
    await agent('server.permissions', { name: server }, { timeoutMs: 120_000 })
    await this.checkSpace(server)
    const safety = await this.archive(server, 'safety', `Before restoring ${row.file}`)

    job.step(2)
    try {
      await this.emptyFolder(dir)
      await extractArchive(this.path(row), dir)
    } catch (err) {
      // Put things back as they were.
      await this.emptyFolder(dir)
      await extractArchive(this.path(safety), dir).catch((again) => {
        throw new BackupError(
          `${(err as Error).message} Putting the old files back failed too (${(again as Error).message}); they are safe in the backup "${safety.file}".`,
          { cause: err },
        )
      })
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
