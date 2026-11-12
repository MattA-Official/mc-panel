/**
 * Staged imports: an upload (in chunks), a download from a URL, or a deleted server's
 * archive lands in its own folder, is unpacked and inspected, and then becomes a server
 * through the create-server job.
 */
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, statfs, truncate, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createZstdDecompress } from 'node:zlib'
import { UNPACK_STEPS, type JobEvent } from '../../shared/utils/jobs'
import { JobError, type JobTracker } from '../jobs/runner'
import { unzip } from '../unzip'
import { detect, type Detected } from './detect'
import { fetchLink, LinkError, type Lookup } from './fetch-link'

export const STAGE_TTL_MS = 24 * 3_600_000
export const MAX_CHUNK = 32 * 1024 * 1024
export const MAX_IMPORT = 64 * 1024 ** 3

export interface ImportMeta {
  id: string
  /** What the person called it: the uploaded file name, URL or archive. */
  label: string
  /** Bytes expected for an upload; null for URL and archive imports. */
  size: number | null
  received: number
  state: 'receiving' | 'received' | 'unpacking' | 'ready' | 'failed'
  detected: Detected | null
  error: string | null
  updatedAt: number
}

export class ImportError extends JobError {}

/** Where an import comes from when it isn't an upload. */
export type ImportSource = { url: string } | { archive: string } | { pastWorld: number } | null

const ID = /^[a-f0-9]{24}$/

export interface ImportDeps {
  importsDir: string
  /** Where the agent leaves archives of deleted servers. */
  archiveDir: string
  /** The zip of a past world, by id; throws if there's no such past world. */
  pastWorldPath?: (id: number) => string
  jobs: { track(kind: string, server: string | null, steps: readonly string[]): JobTracker }
  fetch?: typeof fetch
  /** Resolves a link's host name, for checking where it points. */
  lookup?: Lookup
  now?: () => number
  freeBytes?: (dir: string) => Promise<number>
}

export class ImportService {
  private now: () => number
  private busy = new Set<string>()

  constructor(private deps: ImportDeps) {
    this.now = deps.now ?? Date.now
  }

  private dir(id: string) {
    if (!ID.test(id)) throw new ImportError('No such import.')
    return join(this.deps.importsDir, id)
  }
  private file(id: string) {
    return join(this.dir(id), 'upload')
  }
  /** Where things are unpacked. */
  unpacked(id: string) {
    return join(this.dir(id), 'files')
  }

  async get(id: string): Promise<ImportMeta> {
    const text = await readFile(join(this.dir(id), 'meta.json'), 'utf8').catch(() => null)
    if (!text) throw new ImportError('No such import.')
    return JSON.parse(text) as ImportMeta
  }

  private async save(meta: ImportMeta) {
    meta.updatedAt = this.now()
    await writeFile(join(this.dir(meta.id), 'meta.json'), JSON.stringify(meta))
    return meta
  }

  private async free(dir: string) {
    if (this.deps.freeBytes) return this.deps.freeBytes(dir)
    const s = await statfs(dir)
    return s.bavail * s.bsize
  }

  async start(label: string, size: number | null): Promise<ImportMeta> {
    if (size !== null && (size <= 0 || size > MAX_IMPORT)) {
      throw new ImportError('That file is too big to import here.')
    }
    await mkdir(this.deps.importsDir, { recursive: true, mode: 0o750 })
    // Room for the archive and its unpacked copy.
    if (size !== null && (await this.free(this.deps.importsDir)) < size * 2.2) {
      throw new ImportError("There isn't enough free disk space for this import.")
    }
    const id = Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString('hex')
    await mkdir(this.dir(id), { mode: 0o750 })
    return this.save({
      id,
      label: basename(label).slice(0, 200),
      size,
      received: 0,
      state: 'receiving',
      detected: null,
      error: null,
      updatedAt: 0,
    })
  }

  /** Appends one chunk. `offset` must equal what has arrived so far, so retries are safe. */
  async append(id: string, offset: number, body: ReadableStream<Uint8Array>): Promise<ImportMeta> {
    const meta = await this.get(id)
    if (meta.state !== 'receiving' || meta.size === null) {
      throw new ImportError('This import is not taking uploads.')
    }
    if (offset !== meta.received) {
      throw new ImportError(`Expected the chunk at ${meta.received}, got ${offset}.`)
    }
    if (this.busy.has(id)) throw new ImportError('A chunk for this import is already arriving.')
    this.busy.add(id)
    try {
      let got = 0
      const limit = Math.min(MAX_CHUNK, meta.size - meta.received)
      const counted = Readable.fromWeb(body as never).on('data', (c: Buffer) => {
        got += c.length
        if (got > limit) counted.destroy(new ImportError('That chunk is too big.'))
      })
      await pipeline(counted, createWriteStream(this.file(id), { flags: 'a', mode: 0o640 }))
      meta.received += got
      if (meta.received === meta.size) meta.state = 'received'
      return await this.save(meta)
    } catch (err) {
      // Trim back to the last good length so the chunk can be sent again.
      await truncate(this.file(id), meta.received).catch(() => {})
      throw err
    } finally {
      this.busy.delete(id)
    }
  }

  /** Deleted servers' archives the panel can import from. */
  async archives() {
    const names = (await readdir(this.deps.archiveDir).catch(() => [] as string[])).filter((n) =>
      /^[a-z][a-z0-9-]{1,30}-[\dTZ-]+\.tar\.gz$/.test(n),
    )
    const out = await Promise.all(
      names.map(async (file) => {
        const st = await stat(join(this.deps.archiveDir, file)).catch(() => null)
        if (!st?.isFile()) return null
        const name = file.replace(/-\d{4}-\d{2}-\d{2}T.*$/, '')
        return { file, name, bytes: st.size, deletedAt: st.mtime }
      }),
    )
    return out
      .filter((a) => a !== null)
      .sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime())
  }

  /**
   * Fetches (for URL and archive imports), unpacks and inspects, as a job. `source` is
   * where the archive comes from when it isn't an upload.
   */
  unpack(id: string, source: ImportSource): { jobId: number; done: Promise<JobEvent> } {
    if (this.busy.has(id)) throw new ImportError('This import is already being worked on.')
    this.busy.add(id)
    const job = this.deps.jobs.track('server.import.unpack', null, UNPACK_STEPS)
    const done = this.runUnpack(id, source, job)
      .then((meta) => job.succeed(summary(meta.detected!)))
      .catch(async (err) => {
        const meta = await this.get(id).catch(() => null)
        if (meta) await this.save({ ...meta, state: 'failed', error: (err as Error).message })
        return job.fail(err)
      })
      .finally(() => this.busy.delete(id))
    return { jobId: job.id, done }
  }

  private async runUnpack(id: string, source: ImportSource, job: JobTracker) {
    let meta = await this.get(id)
    job.step(0)
    let archive = this.file(id)
    if (source && 'url' in source) {
      archive = await this.download(id, source.url, job)
    } else if (source && 'archive' in source) {
      const name = basename(source.archive)
      archive = join(this.deps.archiveDir, name)
      if (!(await stat(archive).catch(() => null))?.isFile()) {
        throw new ImportError('That archive has gone.')
      }
    } else if (source && 'pastWorld' in source) {
      try {
        archive = this.deps.pastWorldPath!(source.pastWorld)
      } catch {
        throw new ImportError('That past world has gone.')
      }
      if (!(await stat(archive).catch(() => null))?.isFile()) {
        throw new ImportError('That past world has gone.')
      }
    } else if (meta.state !== 'received') {
      throw new ImportError("The upload hasn't finished.")
    }

    meta = await this.save({ ...meta, state: 'unpacking', error: null })
    job.step(1)
    const out = this.unpacked(id)
    await rm(out, { recursive: true, force: true })
    await mkdir(out, { recursive: true })
    const room = (await this.free(out)) * 0.9
    const kind = await sniff(archive)
    if (kind === 'zip') {
      const r = await unzip(archive, out, { maxBytes: room })
      if (r.skipped.length)
        console.log(`[flytower] import ${id} skipped ${r.skipped.length} entries`)
    } else if (kind === 'gzip' || kind === 'zstd') {
      await untar(archive, kind, out, room)
    } else {
      throw new ImportError("That isn't a .zip, .tar.gz or .tar.zst file.")
    }
    await removeLinks(out)

    job.step(2)
    const detected = await detect(out)
    if (detected.unsupported) {
      throw new ImportError(
        `This looks like a ${detected.unsupported} server. Flytower runs vanilla, Fabric and Paper.`,
      )
    }
    // The upload itself is no longer needed.
    await rm(this.file(id), { force: true })
    return this.save({ ...meta, state: 'ready', detected })
  }

  private async download(id: string, url: string, job: JobTracker) {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new ImportError("That isn't a valid link.")
    }
    let res: Response
    try {
      res = await fetchLink(parsed, { fetch: this.deps.fetch, lookup: this.deps.lookup })
    } catch (err) {
      if (err instanceof LinkError) throw new ImportError(err.message)
      throw err
    }
    if (!res.ok || !res.body) throw new ImportError(`The link answered ${res.status}.`)
    const size = Number(res.headers.get('content-length')) || null
    if (size && size > MAX_IMPORT) throw new ImportError('That file is too big to import here.')
    if (size && (await this.free(this.dir(id))) < size * 2.2) {
      throw new ImportError("There isn't enough free disk space for this import.")
    }
    const dest = this.file(id)
    let got = 0
    let last = 0
    const counted = Readable.fromWeb(res.body as never).on('data', (c: Buffer) => {
      got += c.length
      if (got > MAX_IMPORT) counted.destroy(new ImportError('That file is too big to import here.'))
      if (got - last > 32 * 1024 * 1024) {
        last = got
        job.step(0, size ? `${Math.round((got / size) * 100)}%` : `${Math.round(got / 2 ** 20)} MB`)
      }
    })
    await pipeline(counted, createWriteStream(dest, { mode: 0o640 }))
    return dest
  }

  async remove(id: string) {
    await rm(this.dir(id), { recursive: true, force: true })
  }

  /** Deletes imports nobody has touched for a day. */
  async sweep() {
    let n = 0
    for (const id of await readdir(this.deps.importsDir).catch(() => [] as string[])) {
      if (!ID.test(id) || this.busy.has(id)) continue
      const meta = await this.get(id).catch(() => null)
      const st = await stat(this.dir(id)).catch(() => null)
      const touched = meta?.updatedAt ?? st?.mtimeMs ?? 0
      if (this.now() - touched > STAGE_TTL_MS) {
        await this.remove(id)
        n++
      }
    }
    return n
  }
}

function summary(d: Detected) {
  const what =
    d.kind === 'world'
      ? 'a world'
      : `a ${{ vanilla: 'vanilla', fabric: 'Fabric', paper: 'Paper' }[d.loader]} server`
  return `Found ${what}${d.mcVersion ? ` for Minecraft ${d.mcVersion}` : ''}.`
}

async function sniff(file: string): Promise<'zip' | 'gzip' | 'zstd' | null> {
  const head = new Uint8Array(await Bun.file(file).slice(0, 4).arrayBuffer())
  if (head[0] === 0x50 && head[1] === 0x4b) return 'zip'
  if (head[0] === 0x1f && head[1] === 0x8b) return 'gzip'
  if (head[0] === 0x28 && head[1] === 0xb5 && head[2] === 0x2f && head[3] === 0xfd) return 'zstd'
  return null
}

/**
 * Unpacks a .tar.gz or .tar.zst into `dir`, stopping once more than `maxBytes` has come out
 * so one archive can't fill the disk every server shares. The archive is decompressed here
 * and fed to tar, so what's counted is the tar stream, which is a little more than the files
 * it holds.
 */
export async function untar(
  file: string,
  kind: 'gzip' | 'zstd',
  dir: string,
  maxBytes: number,
): Promise<void> {
  // GNU tar refuses `..` and absolute names, and creates links last, so nothing escapes.
  const proc = Bun.spawn(
    ['tar', '-xf', '-', '--no-same-owner', '--no-same-permissions', '-C', dir],
    { stdin: 'pipe', stdout: 'ignore', stderr: 'pipe' },
  )
  const stderr = new Response(proc.stderr).text()
  const sink = proc.stdin
  let out = 0
  const count = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      out += chunk.length
      if (out > maxBytes)
        return cb(new ImportError("There isn't enough free disk space to unpack this import."))
      cb(null, chunk)
    },
  })
  const toTar = new Writable({
    write(chunk, _enc, cb) {
      Promise.resolve(sink.write(chunk)).then(() => cb(), cb)
    },
    final(cb) {
      Promise.resolve(sink.end()).then(() => cb(), cb)
    },
  })
  try {
    await pipeline(
      createReadStream(file),
      kind === 'gzip' ? createGunzip() : createZstdDecompress(),
      count,
      toTar,
    )
  } catch (err) {
    proc.kill()
    await proc.exited
    if (err instanceof ImportError) throw err
    // tar stopped reading (it failed): its own message says why.
    const why = (await stderr).trim()
    throw new ImportError(`Couldn't unpack it: ${why || (err as Error).message}`)
  }
  if ((await proc.exited) > 1) throw new ImportError(`Couldn't unpack it: ${(await stderr).trim()}`)
}

/** Links from an upload are never kept: they could point anywhere. */
async function removeLinks(dir: string) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isSymbolicLink() || (!e.isFile() && !e.isDirectory())) await rm(p, { force: true })
    else if (e.isDirectory()) await removeLinks(p)
  }
}
