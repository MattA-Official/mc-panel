/**
 * World exports: a zip of a server's world, made with saving paused, kept for a week, and
 * optionally shared through an unguessable link that expires and can be revoked.
 *
 * Past worlds are exports too: the old world kept when a world is reset, with a name and no
 * expiry, so download and share links work the same for them.
 */
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { and, desc, eq, gt, isNotNull, isNull, lte } from 'drizzle-orm'
import { EXPORT_STEPS, type JobEvent } from '../../shared/utils/jobs'
import { schema, type Db } from '../db'
import type { JobTracker } from '../jobs/runner'
import { parseProperties, toRecord } from '../properties'
import { entriesFor, writeZip } from '../zip'
import { resolveInside } from '../files'
import { BackupError, type BackupService, formatBytes } from './service'

export const EXPORT_TTL_MS = 7 * 24 * 3_600_000
export const PAST_WORLD_NAME_MAX = 60
export const SHARE_TTLS = { '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000 } as const
export type ShareTtl = keyof typeof SHARE_TTLS

export type WorldExport = typeof schema.exports.$inferSelect
export type Share = typeof schema.shares.$inferSelect

export const hashToken = (token: string) =>
  new Bun.CryptoHasher('sha256').update(token).digest('hex')

export function newToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
}

/** A safe folder name for the world inside the zip. */
export function worldFolderName(displayName: string, fallback: string) {
  const clean = displayName
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 60)
  return clean || fallback
}

/** A past world's name, tidied; refuses an empty or overlong one. */
export function cleanName(name: string) {
  const clean = name
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) throw new BackupError('Give the past world a name.')
  if (clean.length > PAST_WORLD_NAME_MAX) {
    throw new BackupError(`A name is at most ${PAST_WORLD_NAME_MAX} characters.`)
  }
  return clean
}

export interface ExportDeps {
  db: Db
  exportsDir: string
  serverDir: (name: string) => string
  backups: Pick<BackupService, 'withSavesPaused' | 'lock' | 'ensureSpace'>
  jobs: { track(kind: string, server: string | null, steps: readonly string[]): JobTracker }
  now?: () => Date
}

const stampOf = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')

export class ExportService {
  private now: () => Date

  constructor(private deps: ExportDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  folder(server: string) {
    return join(this.deps.exportsDir, server)
  }

  path(row: WorldExport) {
    return join(this.folder(row.server), row.file)
  }

  /** Whether an export can still be downloaded: past worlds always can. */
  private alive(row: WorldExport) {
    return row.name !== null || row.expiresAt > this.now()
  }

  private withShares<T extends WorldExport>(rows: T[]) {
    const live = this.deps.db
      .select()
      .from(schema.shares)
      .where(and(isNull(schema.shares.revokedAt), gt(schema.shares.expiresAt, this.now())))
      .all()
    return rows.map((r) => ({ ...r, shares: live.filter((s) => s.exportId === r.id) }))
  }

  /** A server's exports that haven't expired, newest first. Past worlds aren't included. */
  list(server: string) {
    const rows = this.deps.db
      .select()
      .from(schema.exports)
      .where(
        and(
          eq(schema.exports.server, server),
          isNull(schema.exports.name),
          gt(schema.exports.expiresAt, this.now()),
        ),
      )
      .all()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return this.withShares(rows)
  }

  /** Past worlds, newest first: one server's, or every server's. */
  pastWorlds(server?: string) {
    const rows = this.deps.db
      .select()
      .from(schema.exports)
      .where(
        server === undefined
          ? isNotNull(schema.exports.name)
          : and(eq(schema.exports.server, server), isNotNull(schema.exports.name)),
      )
      .orderBy(desc(schema.exports.createdAt), desc(schema.exports.id))
      .all()
    return this.withShares(rows)
  }

  get(server: string, id: number): WorldExport {
    const row = this.deps.db
      .select()
      .from(schema.exports)
      .where(and(eq(schema.exports.server, server), eq(schema.exports.id, id)))
      .get()
    if (!row || !this.alive(row)) throw new BackupError('No such export.')
    return row
  }

  /** A past world by id alone, e.g. to start a new server from it. */
  pastWorld(id: number): WorldExport {
    const row = this.deps.db.select().from(schema.exports).where(eq(schema.exports.id, id)).get()
    if (!row || row.name === null) throw new BackupError('No such past world.')
    return row
  }

  /** Starts an export job. */
  export(server: string, displayName: string): { jobId: number; done: Promise<JobEvent> } {
    const release = this.deps.backups.lock(server)
    const job = this.deps.jobs.track('world.export', server, EXPORT_STEPS)
    const done = this.run(server, displayName, job)
      .then((row) => job.succeed(`Exported the world (${formatBytes(row.bytes)}).`))
      .catch((err) => job.fail(err))
      .finally(release)
    return { jobId: job.id, done }
  }

  private async worldDir(server: string) {
    const dir = this.deps.serverDir(server)
    const text = await readFile(join(dir, 'server.properties'), 'utf8').catch(() => '')
    const level = toRecord(parseProperties(text))['level-name'] || 'world'
    const path = await resolveInside(dir, `/${level}`).catch(() => {
      throw new BackupError(`The world folder "${level}" is outside the server folder.`)
    })
    if (!(await Bun.file(join(path, 'level.dat')).exists())) {
      throw new BackupError(`There's no world in "${level}" yet. Start the server once first.`)
    }
    return { path, level }
  }

  /**
   * Zips a world folder that nothing is writing to (the server is stopped) as a past world
   * called `name`. Datapacks come too, so it opens in single player as it was. Checks for
   * room first, so a full disk stops a reset before anything is cleared.
   */
  async keepWorld(server: string, worldPath: string, name: string): Promise<WorldExport> {
    const clean = cleanName(name)
    const entries = await entriesFor(worldPath, worldFolderName(clean, 'world'))
    const total = entries.reduce((n, e) => n + e.size, 0)
    await mkdir(this.folder(server), { recursive: true })
    await this.deps.backups.ensureSpace(this.folder(server), total)
    const createdAt = this.now()
    const file = `${server}-past-world-${stampOf(createdAt)}.zip`
    const dest = join(this.folder(server), file)
    try {
      const { bytes } = await writeZip(entries, `${dest}.partial`)
      await rename(`${dest}.partial`, dest)
      return this.deps.db
        .insert(schema.exports)
        .values({ server, file, bytes, createdAt, expiresAt: createdAt, name: clean })
        .returning()
        .get()
    } catch (err) {
      await rm(`${dest}.partial`, { force: true })
      throw err
    }
  }

  renamePastWorld(server: string, id: number, name: string): WorldExport {
    const row = this.get(server, id)
    if (row.name === null) throw new BackupError('No such past world.')
    return this.deps.db
      .update(schema.exports)
      .set({ name: cleanName(name) })
      .where(eq(schema.exports.id, id))
      .returning()
      .get()
  }

  private async run(server: string, displayName: string, job: JobTracker) {
    const { db } = this.deps
    job.step(0)
    const world = await this.worldDir(server)
    const entries = await entriesFor(world.path, worldFolderName(displayName, world.level))
    const total = entries.reduce((n, e) => n + e.size, 0)
    await this.deps.backups.ensureSpace(this.folder(server), total)

    return this.deps.backups.withSavesPaused(
      server,
      (running) =>
        job.step(1, running ? 'Pausing autosave and flushing to disk' : 'The server is stopped'),
      async () => {
        job.step(2, `${formatBytes(total)} to zip`)
        // Re-list now the world is flushed, so new region files are included.
        const fresh = await entriesFor(world.path, worldFolderName(displayName, world.level))
        const createdAt = this.now()
        const file = `${server}-world-${stampOf(createdAt)}.zip`
        const dest = join(this.folder(server), file)
        let last = 0
        try {
          const { bytes } = await writeZip(fresh, `${dest}.partial`, {
            onProgress: (n) => {
              if (n - last < 64 * 1024 * 1024) return
              last = n
              job.step(2, `${formatBytes(n)} of ${formatBytes(total)}`)
            },
          })
          await rename(`${dest}.partial`, dest)
          return db
            .insert(schema.exports)
            .values({
              server,
              file,
              bytes,
              createdAt,
              expiresAt: new Date(createdAt.getTime() + EXPORT_TTL_MS),
            })
            .returning()
            .get()
        } catch (err) {
          await rm(`${dest}.partial`, { force: true })
          throw err
        }
      },
    )
  }

  async remove(server: string, id: number) {
    const row = this.get(server, id)
    await rm(this.path(row), { force: true })
    this.deps.db.delete(schema.exports).where(eq(schema.exports.id, id)).run()
    return row
  }

  /** Makes a share link. Returns the token, which is never stored. */
  share(server: string, id: number, ttl: ShareTtl, userId: number) {
    const row = this.get(server, id)
    const token = newToken()
    const until = this.now().getTime() + SHARE_TTLS[ttl]
    // A link never outlives its export; past worlds don't expire.
    const expiresAt = new Date(row.name === null ? Math.min(until, row.expiresAt.getTime()) : until)
    const share = this.deps.db
      .insert(schema.shares)
      .values({ exportId: row.id, tokenHash: hashToken(token), createdBy: userId, expiresAt })
      .returning()
      .get()
    return { token, share }
  }

  revoke(server: string, exportId: number, shareId: number) {
    this.get(server, exportId)
    const out = this.deps.db
      .update(schema.shares)
      .set({ revokedAt: this.now() })
      .where(and(eq(schema.shares.id, shareId), eq(schema.shares.exportId, exportId)))
      .returning()
      .get()
    if (!out) throw new BackupError('No such share link.')
    return out
  }

  /** The export behind a live token, counting the download; null for anything else. */
  redeem(token: string): WorldExport | null {
    if (!/^[\w-]{43}$/.test(token)) return null
    const { db } = this.deps
    const now = this.now()
    const share = db
      .select()
      .from(schema.shares)
      .where(eq(schema.shares.tokenHash, hashToken(token)))
      .get()
    if (!share || share.revokedAt || share.expiresAt <= now) return null
    const row = db.select().from(schema.exports).where(eq(schema.exports.id, share.exportId)).get()
    if (!row || !this.alive(row)) return null
    db.update(schema.shares)
      .set({ downloads: share.downloads + 1 })
      .where(eq(schema.shares.id, share.id))
      .run()
    return row
  }

  /**
   * Deletes a server's exports when the server is deleted. Past worlds stay, like its
   * backups do, and can still become a new server through Import.
   */
  async removeAll(server: string) {
    const { db } = this.deps
    const rows = db
      .select()
      .from(schema.exports)
      .where(and(eq(schema.exports.server, server), isNull(schema.exports.name)))
      .all()
    for (const row of rows) {
      await rm(this.path(row), { force: true })
      db.delete(schema.exports).where(eq(schema.exports.id, row.id)).run()
    }
  }

  /** Deletes expired exports (and with them their links). Past worlds stay. */
  async sweep() {
    const { db } = this.deps
    const old = db
      .select()
      .from(schema.exports)
      .where(and(isNull(schema.exports.name), lte(schema.exports.expiresAt, this.now())))
      .all()
    for (const row of old) {
      await rm(this.path(row), { force: true })
      db.delete(schema.exports).where(eq(schema.exports.id, row.id)).run()
    }
    return old.length
  }
}
