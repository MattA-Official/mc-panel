/**
 * A small streaming zip writer: deflate, UTF-8 names, Unix modes, and zip64 when a file or
 * the archive passes 4 GB. Bun has no zip support and worlds can be large, so this streams
 * each file through zlib straight to disk and never holds a whole file in memory.
 */
import { createReadStream } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createDeflateRaw } from 'node:zlib'

export interface ZipEntry {
  /** Name inside the zip, with forward slashes. Folders end in `/`. */
  name: string
  /** File on disk; null for a folder. */
  source: string | null
  size: number
  mtime: Date
  mode: number
}

export interface ZipOptions {
  level?: number
  /** Use zip64 records for everything; for tests. */
  forceZip64?: boolean
  onProgress?: (bytesRead: number) => void
}

const MAX32 = 0xffffffff
const MAX16 = 0xffff
// Deflate can grow incompressible data a little, so switch early.
const ZIP64_FROM = 0xffff0000

function dosDateTime(d: Date) {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

class Bytes {
  private view: DataView
  private at = 0
  readonly buf: Uint8Array
  constructor(size: number) {
    this.buf = new Uint8Array(size)
    this.view = new DataView(this.buf.buffer)
  }
  u16(n: number) {
    this.view.setUint16(this.at, n, true)
    this.at += 2
    return this
  }
  u32(n: number) {
    this.view.setUint32(this.at, n >>> 0, true)
    this.at += 4
    return this
  }
  u64(n: number) {
    this.view.setBigUint64(this.at, BigInt(n), true)
    this.at += 8
    return this
  }
  bytes(b: Uint8Array) {
    this.buf.set(b, this.at)
    this.at += b.length
    return this
  }
}

interface Written {
  name: Uint8Array
  dir: boolean
  zip64: boolean
  crc: number
  csize: number
  usize: number
  offset: number
  time: number
  date: number
  mode: number
}

export async function writeZip(entries: ZipEntry[], dest: string, opts: ZipOptions = {}) {
  const sink = Bun.file(dest).writer({ highWaterMark: 1 << 20 })
  let offset = 0
  let read = 0
  const write = async (b: Uint8Array) => {
    await sink.write(b)
    offset += b.length
  }
  const written: Written[] = []
  const utf8 = new TextEncoder()

  try {
    for (const e of entries) {
      const dir = e.source === null
      const name = utf8.encode(dir && !e.name.endsWith('/') ? `${e.name}/` : e.name)
      const zip64 = !!opts.forceZip64 || e.size >= ZIP64_FROM
      const { time, date } = dosDateTime(e.mtime)
      const w: Written = {
        name,
        dir,
        zip64,
        crc: 0,
        csize: 0,
        usize: 0,
        offset,
        time,
        date,
        mode: e.mode,
      }

      const extra = zip64 ? 20 : 0
      const local = new Bytes(30 + name.length + extra)
        .u32(0x04034b50)
        .u16(zip64 ? 45 : 20)
        .u16(0x0808) // sizes in a data descriptor; UTF-8 names
        .u16(dir ? 0 : 8)
        .u16(time)
        .u16(date)
        .u32(0)
        .u32(zip64 ? MAX32 : 0)
        .u32(zip64 ? MAX32 : 0)
        .u16(name.length)
        .u16(extra)
        .bytes(name)
      if (zip64) local.u16(0x0001).u16(16).u64(0).u64(0)
      await write(local.buf)

      if (!dir) {
        const count = new Transform({
          transform(chunk: Uint8Array, _enc, cb) {
            w.crc = Bun.hash.crc32(chunk, w.crc)
            w.usize += chunk.length
            read += chunk.length
            opts.onProgress?.(read)
            cb(null, chunk)
          },
        })
        await pipeline(
          createReadStream(e.source!),
          count,
          createDeflateRaw({ level: opts.level ?? 6 }),
          async (source: AsyncIterable<Uint8Array>) => {
            for await (const chunk of source) {
              w.csize += chunk.length
              await write(chunk)
            }
          },
        )
      }

      const desc = zip64
        ? new Bytes(24).u32(0x08074b50).u32(w.crc).u64(w.csize).u64(w.usize)
        : new Bytes(16).u32(0x08074b50).u32(w.crc).u32(w.csize).u32(w.usize)
      await write(desc.buf)
      written.push(w)
    }

    // Central directory.
    const cdStart = offset
    for (const w of written) {
      const bigSizes = w.zip64 || w.csize >= MAX32 || w.usize >= MAX32
      const bigOffset = w.offset >= MAX32 || !!opts.forceZip64
      const extraLen = (bigSizes ? 16 : 0) + (bigOffset ? 8 : 0)
      const extra = extraLen ? 4 + extraLen : 0
      const attrs = w.dir
        ? ((0o40755 << 16) | 0x10) >>> 0
        : (((w.mode & 0o7777) | 0o100000) << 16) >>> 0
      const cd = new Bytes(46 + w.name.length + extra)
        .u32(0x02014b50)
        .u16((3 << 8) | 45) // made by Unix, zip 4.5
        .u16(w.zip64 ? 45 : 20)
        .u16(0x0808)
        .u16(w.dir ? 0 : 8)
        .u16(w.time)
        .u16(w.date)
        .u32(w.crc)
        .u32(bigSizes ? MAX32 : w.csize)
        .u32(bigSizes ? MAX32 : w.usize)
        .u16(w.name.length)
        .u16(extra)
        .u16(0)
        .u16(0)
        .u16(0)
        .u32(attrs)
        .u32(bigOffset ? MAX32 : w.offset)
        .bytes(w.name)
      if (extra) {
        cd.u16(0x0001).u16(extraLen)
        if (bigSizes) cd.u64(w.usize).u64(w.csize)
        if (bigOffset) cd.u64(w.offset)
      }
      await write(cd.buf)
    }
    const cdSize = offset - cdStart
    const count = written.length
    const zip64End = !!opts.forceZip64 || count >= MAX16 || cdStart >= MAX32 || cdSize >= MAX32

    if (zip64End) {
      const recordAt = offset
      await write(
        new Bytes(56)
          .u32(0x06064b50)
          .u64(44)
          .u16((3 << 8) | 45)
          .u16(45)
          .u32(0)
          .u32(0)
          .u64(count)
          .u64(count)
          .u64(cdSize)
          .u64(cdStart).buf,
      )
      await write(new Bytes(20).u32(0x07064b50).u32(0).u64(recordAt).u32(1).buf)
    }
    await write(
      new Bytes(22)
        .u32(0x06054b50)
        .u16(0)
        .u16(0)
        .u16(zip64End ? MAX16 : count)
        .u16(zip64End ? MAX16 : count)
        .u32(zip64End ? MAX32 : cdSize)
        .u32(zip64End ? MAX32 : cdStart)
        .u16(0).buf,
    )
    await sink.end()
  } catch (err) {
    await Promise.resolve(sink.end()).catch(() => {})
    throw err
  }
  return { bytes: offset, files: written.filter((w) => !w.dir).length }
}

/** Every folder and regular file under `dir`, named under `prefix/`. Symlinks are skipped. */
export async function entriesFor(dir: string, prefix: string): Promise<ZipEntry[]> {
  const out: ZipEntry[] = []
  const walk = async (abs: string, rel: string) => {
    const st = await lstat(abs)
    if (st.isDirectory()) {
      out.push({ name: `${rel}/`, source: null, size: 0, mtime: st.mtime, mode: st.mode })
      for (const name of (await readdir(abs)).sort()) await walk(join(abs, name), `${rel}/${name}`)
    } else if (st.isFile()) {
      out.push({ name: rel, source: abs, size: st.size, mtime: st.mtime, mode: st.mode })
    }
  }
  await walk(dir, prefix)
  return out
}
