/**
 * Off-site copies of backups, on S3-compatible storage (Backblaze B2, Cloudflare R2,
 * Wasabi, AWS, MinIO). Uploads happen in the background after a backup and retry on
 * failure; deleting a backup deletes its copy; a backup whose local file is gone can still
 * be restored from its copy.
 */
import { stat } from 'node:fs/promises'
import { and, eq, inArray, isNull, lt } from 'drizzle-orm'
import { schema, type Db } from '../db'
import type { Notifier } from '../notify/types'

export type Target = typeof schema.backupTargets.$inferSelect
type Backup = typeof schema.backups.$inferSelect

/** What Flytower needs from a bucket. */
export interface ObjectStore {
  put(key: string, path: string): Promise<void>
  /** Writes the object to `path`; returns its size. */
  get(key: string, path: string): Promise<number>
  delete(key: string): Promise<void>
  /** The object's size, or null if there is none. */
  size(key: string): Promise<number | null>
}

export interface TargetInput {
  name: string
  endpoint: string
  region: string
  bucket: string
  prefix: string
  accessKeyId: string
  secretAccessKey: string
}

export interface OffsiteDeps {
  db: Db
  /** Builds a store for a target, given its decrypted secret. */
  store: (target: Omit<TargetInput, 'name' | 'prefix'>) => ObjectStore
  /** Encrypts and decrypts target secrets. */
  seal: (plain: string) => Promise<string>
  unseal: (sealed: string) => Promise<string>
  /** The local path of a backup's archive. */
  localPath: (row: Backup) => string
  now?: () => Date
  /** Delays between retries; tests shorten them. */
  backoffMs?: number[]
  /** Tells people when copies keep failing, and when they work again. */
  notifier?: Notifier
}

export class OffsiteError extends Error {}

const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000]
const MAX_ATTEMPTS = 6

/** Turns an S3 or network error into something a person can act on. */
export function explain(err: unknown): string {
  const e = err as { code?: string; message?: string; name?: string }
  const code = e.code ?? e.name ?? ''
  const msg = e.message ?? String(err)
  if (/AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch|Forbidden|403/i.test(code + msg))
    return 'The storage refused the key. Check the access key, secret and their permissions.'
  if (/NoSuchBucket/i.test(code + msg)) return "That bucket doesn't exist."
  if (/ECONNREFUSED|ENOTFOUND|ConnectionRefused|Unable to connect|fetch failed/i.test(code + msg))
    return "Couldn't reach the storage endpoint. Check the address."
  return msg.slice(0, 300)
}

export class OffsiteService {
  private now: () => Date
  private backoff: number[]
  private current: Promise<void> | null = null
  private again = false
  private timers = new Set<ReturnType<typeof setTimeout>>()

  constructor(private deps: OffsiteDeps) {
    this.now = deps.now ?? (() => new Date())
    this.backoff = deps.backoffMs ?? BACKOFF_MS
  }

  // ----------------------------------------------------------------- targets

  /** Targets as the browser sees them: never the secret. */
  targets() {
    return this.deps.db
      .select({
        id: schema.backupTargets.id,
        name: schema.backupTargets.name,
        endpoint: schema.backupTargets.endpoint,
        region: schema.backupTargets.region,
        bucket: schema.backupTargets.bucket,
        prefix: schema.backupTargets.prefix,
        accessKeyId: schema.backupTargets.accessKeyId,
        createdAt: schema.backupTargets.createdAt,
      })
      .from(schema.backupTargets)
      .all()
  }

  target(id: number): Target {
    const t = this.deps.db
      .select()
      .from(schema.backupTargets)
      .where(eq(schema.backupTargets.id, id))
      .get()
    if (!t) throw new OffsiteError('No such backup target.')
    return t
  }

  targetByName(name: string): Target | undefined {
    return this.deps.db
      .select()
      .from(schema.backupTargets)
      .where(eq(schema.backupTargets.name, name))
      .get()
  }

  private async storeFor(t: Target): Promise<ObjectStore> {
    return this.deps.store({
      endpoint: t.endpoint,
      region: t.region,
      bucket: t.bucket,
      accessKeyId: t.accessKeyId,
      secretAccessKey: await this.deps.unseal(t.secretSealed),
    })
  }

  /** Writes, reads back and deletes a small object; throws naming the step that failed. */
  async test(input: TargetInput): Promise<void> {
    const store = this.deps.store(input)
    const key = `${input.prefix ? `${input.prefix}/` : ''}.flytower-test-${Date.now()}`
    const dir = await import('node:os').then((os) => os.tmpdir())
    const local = `${dir}/flytower-offsite-test-${process.pid}-${Date.now()}`
    await Bun.write(local, 'flytower')
    const step = async (what: string, fn: () => Promise<unknown>) => {
      try {
        await fn()
      } catch (err) {
        throw new OffsiteError(`${what} failed: ${explain(err)}`)
      }
    }
    try {
      await step('Writing a test file', () => store.put(key, local))
      await step('Reading it back', async () => {
        if ((await store.size(key)) !== 8) throw new Error('the test file came back wrong')
      })
      await step('Deleting it', () => store.delete(key))
    } finally {
      await Bun.file(local)
        .delete()
        .catch(() => {})
    }
  }

  async addTarget(input: TargetInput) {
    if (this.targetByName(input.name)) {
      throw new OffsiteError(`There's already a target called ${input.name}.`)
    }
    await this.test(input)
    const { secretAccessKey, ...rest } = input
    return this.deps.db
      .insert(schema.backupTargets)
      .values({ ...rest, secretSealed: await this.deps.seal(secretAccessKey) })
      .returning({ id: schema.backupTargets.id, name: schema.backupTargets.name })
      .get()
  }

  /** Removes a target. Servers using it stop copying; copies already made stay in the bucket. */
  removeTarget(id: number) {
    const t = this.target(id)
    const { db } = this.deps
    db.update(schema.servers)
      .set({ offsiteTarget: null })
      .where(eq(schema.servers.offsiteTarget, id))
      .run()
    db.update(schema.backups)
      .set({ offsiteState: null, offsiteTarget: null, offsiteKey: null, offsiteError: null })
      .where(
        and(
          eq(schema.backups.offsiteTarget, id),
          inArray(schema.backups.offsiteState, ['pending', 'uploading', 'failed']),
        ),
      )
      .run()
    db.delete(schema.backupTargets).where(eq(schema.backupTargets.id, id)).run()
    return t
  }

  // ----------------------------------------------------------------- uploads

  /** Marks a new backup for upload if its server has a target, and starts uploading. */
  queue(row: Backup) {
    const server = this.deps.db
      .select({ target: schema.servers.offsiteTarget })
      .from(schema.servers)
      .where(eq(schema.servers.name, row.server))
      .get()
    if (!server?.target) return
    const t = this.deps.db
      .select({ prefix: schema.backupTargets.prefix })
      .from(schema.backupTargets)
      .where(eq(schema.backupTargets.id, server.target))
      .get()
    if (!t) return
    const key = [t.prefix, row.server, row.file].filter(Boolean).join('/')
    this.deps.db
      .update(schema.backups)
      .set({
        offsiteState: 'pending',
        offsiteTarget: server.target,
        offsiteKey: key,
        offsiteError: null,
        offsiteAttempts: 0,
      })
      .where(eq(schema.backups.id, row.id))
      .run()
    void this.kick()
  }

  /** Queues a server's backups that have never been copied (after it gains a target). */
  queueServer(server: string) {
    const waiting = this.deps.db
      .select()
      .from(schema.backups)
      .where(and(eq(schema.backups.server, server), isNull(schema.backups.offsiteState)))
      .all()
    for (const row of waiting) this.queue(row)
  }

  /** Tries a failed upload again now. */
  retry(id: number) {
    this.deps.db
      .update(schema.backups)
      .set({ offsiteState: 'pending', offsiteError: null, offsiteAttempts: 0 })
      .where(and(eq(schema.backups.id, id), eq(schema.backups.offsiteState, 'failed')))
      .run()
    void this.kick()
  }

  /** Uploads everything pending, one at a time. Resolves when the queue is empty. */
  kick(): Promise<void> {
    if (this.current) {
      this.again = true
      return this.current
    }
    this.current = (async () => {
      // Without this the body can finish (and clear `current`) before `current` is set.
      await Promise.resolve()
      try {
        do {
          this.again = false
          const pending = this.deps.db
            .select()
            .from(schema.backups)
            .where(eq(schema.backups.offsiteState, 'pending'))
            .all()
          for (const row of pending) await this.upload(row)
        } while (this.again)
      } finally {
        this.current = null
      }
    })()
    return this.current
  }

  private async upload(row: Backup) {
    const { db } = this.deps
    const set = (v: Partial<Backup>) =>
      db.update(schema.backups).set(v).where(eq(schema.backups.id, row.id)).run()
    if (!row.offsiteTarget || !row.offsiteKey) return
    set({ offsiteState: 'uploading' })
    try {
      const t = this.target(row.offsiteTarget)
      const path = this.deps.localPath(row)
      await stat(path)
      const store = await this.storeFor(t)
      await store.put(row.offsiteKey, path)
      const size = await store.size(row.offsiteKey)
      if (size !== row.bytes) {
        throw new Error(`the copy is ${size ?? 'missing'} bytes, not ${row.bytes}`)
      }
      set({ offsiteState: 'done', offsiteError: null, offsiteAt: this.now() })
      this.deps.notifier?.resolve({
        kind: 'offsite.failed',
        server: row.server,
        title: 'Off-site copies are working again',
        detail: `${row.file} was copied to off-site storage.`,
        severity: 'ok',
        link: `/servers/${row.server}/world`,
      })
    } catch (err) {
      console.error(`[flytower] off-site copy of ${row.server}/${row.file} failed`, err)
      const attempts = row.offsiteAttempts + 1
      // A deleted backup or target has nothing left to retry.
      const gone = !db.select().from(schema.backups).where(eq(schema.backups.id, row.id)).get()
      if (gone) return
      set({ offsiteState: 'failed', offsiteError: explain(err), offsiteAttempts: attempts })
      const wait = this.backoff[attempts - 1]
      const retrying = wait !== undefined && attempts < MAX_ATTEMPTS
      // One blip that the next try fixes isn't worth a message.
      if (attempts >= 2 || !retrying) {
        this.deps.notifier?.notify({
          kind: 'offsite.failed',
          server: row.server,
          title: 'Copying a backup off-site failed',
          detail: `${explain(err)} Flytower keeps retrying for a while, and you can retry it from the Backups tab.`,
          severity: 'warning',
          link: `/servers/${row.server}/world`,
        })
      }
      if (retrying) {
        const timer = setTimeout(() => {
          this.timers.delete(timer)
          set({ offsiteState: 'pending' })
          void this.kick()
        }, wait)
        this.timers.add(timer)
      }
    }
  }

  /** Picks up uploads left pending or cut off by a restart, and failures still retrying. */
  sweep() {
    this.deps.db
      .update(schema.backups)
      .set({ offsiteState: 'pending' })
      .where(
        and(
          inArray(schema.backups.offsiteState, ['uploading', 'failed']),
          lt(schema.backups.offsiteAttempts, MAX_ATTEMPTS),
        ),
      )
      .run()
    return this.kick()
  }

  stop() {
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
  }

  // ----------------------------------------------------------------- copies

  /** Deletes a backup's off-site copy, if it has one. Errors are logged, not thrown. */
  async removeCopy(row: Backup) {
    if (!row.offsiteTarget || !row.offsiteKey || row.offsiteState !== 'done') return
    try {
      const t = this.target(row.offsiteTarget)
      await (await this.storeFor(t)).delete(row.offsiteKey)
    } catch (err) {
      console.error(`[flytower] couldn't delete the off-site copy of ${row.file}`, err)
    }
  }

  /** Downloads a backup's copy to its local path, checking the size. */
  async fetch(row: Backup): Promise<void> {
    if (row.offsiteState !== 'done' || !row.offsiteTarget || !row.offsiteKey) {
      throw new OffsiteError('This backup has no off-site copy.')
    }
    const store = await this.storeFor(this.target(row.offsiteTarget))
    const path = this.deps.localPath(row)
    const { mkdir, rename } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    await mkdir(dirname(path), { recursive: true, mode: 0o750 })
    const partial = `${path}.download`
    let bytes: number
    try {
      bytes = await store.get(row.offsiteKey, partial)
    } catch (err) {
      await Bun.file(partial)
        .delete()
        .catch(() => {})
      throw new OffsiteError(`Downloading the off-site copy failed: ${explain(err)}`)
    }
    if (bytes !== row.bytes) {
      await Bun.file(partial)
        .delete()
        .catch(() => {})
      throw new OffsiteError(`The off-site copy is ${bytes} bytes, not ${row.bytes}.`)
    }
    await rename(partial, path)
  }
}

/** A store backed by Bun's S3 client. */
export function s3Store(t: Omit<TargetInput, 'name' | 'prefix'>): ObjectStore {
  const client = new Bun.S3Client({
    endpoint: t.endpoint,
    region: t.region || 'auto',
    bucket: t.bucket,
    accessKeyId: t.accessKeyId,
    secretAccessKey: t.secretAccessKey,
  })
  return {
    async put(key, path) {
      const writer = client.file(key).writer({ partSize: 16 * 1024 * 1024, retry: 3 })
      for await (const chunk of Bun.file(path).stream()) {
        await writer.write(chunk)
      }
      await writer.end()
    },
    async get(key, path) {
      return Bun.write(path, client.file(key))
    },
    async delete(key) {
      await client.delete(key)
    },
    async size(key) {
      try {
        return (await client.stat(key)).size
      } catch (err) {
        if (/NoSuchKey|NotFound|404/i.test(String((err as Error).message ?? err))) return null
        throw err
      }
    },
  }
}

/** Seals secrets with AES-256-GCM under a key derived from the app secret. */
export function sealer(hexKey: () => Promise<string>) {
  let key: Promise<CryptoKey> | undefined
  const getKey = () =>
    (key ??= hexKey().then((hex) =>
      crypto.subtle.importKey('raw', Buffer.from(hex, 'hex'), 'AES-GCM', false, [
        'encrypt',
        'decrypt',
      ]),
    ))
  return {
    async seal(plain: string) {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        await getKey(),
        new TextEncoder().encode(plain),
      )
      return `v1:${Buffer.concat([iv, new Uint8Array(ct)]).toString('base64')}`
    },
    async unseal(sealed: string) {
      if (!sealed.startsWith('v1:')) throw new OffsiteError('Unreadable stored secret.')
      const raw = Buffer.from(sealed.slice(3), 'base64')
      try {
        const pt = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: raw.subarray(0, 12) },
          await getKey(),
          raw.subarray(12),
        )
        return new TextDecoder().decode(pt)
      } catch {
        throw new OffsiteError(
          "The stored secret can't be read; the app secret may have changed. Remove the target and add it again.",
        )
      }
    },
  }
}
