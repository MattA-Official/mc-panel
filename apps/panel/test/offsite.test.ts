import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDb, schema } from '../server/db'
import { OffsiteService, sealer, type ObjectStore } from '../server/backups/offsite'

function fakeBucket() {
  const objects = new Map<string, Uint8Array>()
  let failPuts = 0
  const store: ObjectStore = {
    async put(key, path) {
      if (failPuts > 0) {
        failPuts--
        throw Object.assign(new Error('Unable to connect'), { code: 'ConnectionRefused' })
      }
      objects.set(key, new Uint8Array(await Bun.file(path).arrayBuffer()))
    },
    async get(key, path) {
      const o = objects.get(key)
      if (!o) throw new Error('NoSuchKey')
      return Bun.write(path, o)
    },
    async delete(key) {
      objects.delete(key)
    },
    async size(key) {
      return objects.get(key)?.byteLength ?? null
    },
  }
  return { store, objects, failNext: (n: number) => (failPuts = n) }
}

const seal = sealer(async () => 'ab'.repeat(32))

function setup() {
  const db = openDb(':memory:')
  const dir = mkdtempSync(join(tmpdir(), 'ft-offsite-'))
  const bucket = fakeBucket()
  const secrets: string[] = []
  const offsite = new OffsiteService({
    db,
    store: (t) => {
      secrets.push(t.secretAccessKey)
      return bucket.store
    },
    seal: seal.seal,
    unseal: seal.unseal,
    localPath: (row) => join(dir, row.server, row.file),
    backoffMs: [5, 5, 5],
  })
  db.insert(schema.servers)
    .values({
      name: 'survival',
      displayName: 'Survival',
      loader: 'vanilla',
      mcVersion: '26.3',
      javaMajor: 25,
      memoryMb: 2048,
      port: 25565,
      rconPort: 35575,
      rconPassword: 'x',
      eulaAcceptedAt: new Date(),
    })
    .run()
  const backup = (file: string, body = 'archive bytes') => {
    mkdirSync(join(dir, 'survival'), { recursive: true })
    writeFileSync(join(dir, 'survival', file), body)
    return db
      .insert(schema.backups)
      .values({ server: 'survival', file, bytes: body.length, kind: 'manual' })
      .returning()
      .get()
  }
  const row = (id: number) =>
    db.select().from(schema.backups).where(eq(schema.backups.id, id)).get()!
  return { db, dir, bucket, offsite, secrets, backup, row }
}

const input = {
  name: 'b2',
  endpoint: 'https://s3.example.com',
  region: 'auto',
  bucket: 'mc-backups',
  prefix: 'flytower',
  accessKeyId: 'key',
  secretAccessKey: 'shh-secret',
}

describe('sealer', () => {
  it('round-trips, and refuses under another key', async () => {
    const sealed = await seal.seal('shh')
    expect(sealed).not.toContain('shh')
    expect(await seal.unseal(sealed)).toBe('shh')
    await expect(sealer(async () => 'cd'.repeat(32)).unseal(sealed)).rejects.toThrow(
      'app secret may have changed',
    )
  })
})

describe('OffsiteService', () => {
  it('adds a tested target and never hands back its secret', async () => {
    const { offsite, db } = setup()
    await offsite.addTarget(input)
    expect(JSON.stringify(offsite.targets())).not.toContain('shh-secret')
    const stored = db.select().from(schema.backupTargets).get()!
    expect(stored.secretSealed).not.toContain('shh-secret')
    await expect(offsite.addTarget(input)).rejects.toThrow('already a target called b2')
  })

  it('still uploads after a sweep that found nothing to do', async () => {
    const { offsite, db, bucket, backup, row } = setup()
    const { id: target } = await offsite.addTarget(input)
    await offsite.sweep()
    db.update(schema.servers).set({ offsiteTarget: target }).run()
    const b = backup('survival-0.tar.zst')
    offsite.queue(b)
    await offsite.kick()
    expect(row(b.id)).toMatchObject({ offsiteState: 'done' })
    expect(bucket.objects.size).toBe(1)
  })

  it('uploads new backups, retries failures, and deletes copies with the backup', async () => {
    const { offsite, db, bucket, backup, row, secrets } = setup()
    const { id: target } = await offsite.addTarget(input)
    db.update(schema.servers).set({ offsiteTarget: target }).run()

    bucket.failNext(1)
    const b = backup('survival-1.tar.zst')
    offsite.queue(b)
    await offsite.kick()
    expect(row(b.id)).toMatchObject({ offsiteState: 'failed', offsiteAttempts: 1 })
    expect(row(b.id).offsiteError).toContain("Couldn't reach")
    await Bun.sleep(30)
    await offsite.kick()
    expect(row(b.id)).toMatchObject({ offsiteState: 'done' })
    expect(bucket.objects.has('flytower/survival/survival-1.tar.zst')).toBe(true)
    expect(secrets.at(-1)).toBe('shh-secret')

    await offsite.removeCopy(row(b.id))
    expect(bucket.objects.size).toBe(0)
    offsite.stop()
  })

  it('brings back a copy whose local file is gone, checking its size', async () => {
    const { offsite, db, dir, backup, row, bucket } = setup()
    const { id: target } = await offsite.addTarget(input)
    db.update(schema.servers).set({ offsiteTarget: target }).run()
    const b = backup('survival-2.tar.zst', 'the world')
    offsite.queue(b)
    await offsite.kick()
    const path = join(dir, 'survival', 'survival-2.tar.zst')
    await Bun.file(path).delete()
    await offsite.fetch(row(b.id))
    expect(readFileSync(path, 'utf8')).toBe('the world')

    bucket.objects.set('flytower/survival/survival-2.tar.zst', new Uint8Array([1]))
    await Bun.file(path).delete()
    await expect(offsite.fetch(row(b.id))).rejects.toThrow('1 bytes, not 9')
    expect(existsSync(path)).toBe(false)
  })

  it('removing a target stops copying but keeps finished copies on record', async () => {
    const { offsite, db, backup, row } = setup()
    const { id: target } = await offsite.addTarget(input)
    db.update(schema.servers).set({ offsiteTarget: target }).run()
    const done = backup('a.tar.zst')
    offsite.queue(done)
    await offsite.kick()
    offsite.removeTarget(target)
    expect(db.select().from(schema.servers).get()!.offsiteTarget).toBeNull()
    expect(row(done.id).offsiteState).toBe('done')
  })
})
