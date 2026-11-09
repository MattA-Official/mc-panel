/**
 * A small zip reader to go with zip.ts: stored and deflated entries, zip64, UTF-8 names.
 * Written for untrusted uploads, so it refuses anything that would land outside the target
 * folder, skips links and devices, checks every CRC, and stops a file that inflates past
 * its declared size (zip bombs).
 */
import { createWriteStream } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createInflateRaw } from 'node:zlib'

export class ZipError extends Error {
  override name = 'ZipError'
}

export interface ZipItem {
  name: string
  dir: boolean
  method: number
  crc: number
  csize: number
  usize: number
  offset: number
  mode: number
}

const MAX32 = 0xffffffff

async function readAt(fd: Awaited<ReturnType<typeof open>>, pos: number, len: number) {
  const buf = Buffer.alloc(len)
  const { bytesRead } = await fd.read(buf, 0, len, pos)
  return buf.subarray(0, bytesRead)
}

/** Turns an entry name into a safe relative path, or null if it must be refused. */
export function safeName(raw: string): string | null {
  const name = raw.replace(/\\/g, '/')
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return null
  const parts: string[] = []
  for (const p of name.split('/')) {
    if (p === '' || p === '.') continue
    if (p === '..' || p.includes('\0')) return null
    parts.push(p)
  }
  return parts.length ? parts.join('/') : null
}

/** Reads the central directory. */
export async function listZip(file: string): Promise<ZipItem[]> {
  const fd = await open(file, 'r')
  try {
    const size = (await fd.stat()).size
    const tailLen = Math.min(size, 65_557)
    const tail = await readAt(fd, size - tailLen, tailLen)
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i
        break
      }
    }
    if (eocd < 0) throw new ZipError("This isn't a zip file, or it's incomplete.")
    let count = tail.readUInt16LE(eocd + 10)
    let cdSize = tail.readUInt32LE(eocd + 12)
    let cdStart = tail.readUInt32LE(eocd + 16)

    if (count === 0xffff || cdSize === MAX32 || cdStart === MAX32) {
      const locAt = size - tailLen + eocd - 20
      const loc = await readAt(fd, locAt, 20)
      if (loc.readUInt32LE(0) !== 0x07064b50) throw new ZipError('The zip64 locator is missing.')
      const recAt = Number(loc.readBigUInt64LE(8))
      const rec = await readAt(fd, recAt, 56)
      if (rec.readUInt32LE(0) !== 0x06064b50) throw new ZipError('The zip64 record is missing.')
      count = Number(rec.readBigUInt64LE(32))
      cdSize = Number(rec.readBigUInt64LE(40))
      cdStart = Number(rec.readBigUInt64LE(48))
    }
    if (cdSize > 256 * 1024 * 1024 || cdStart + cdSize > size) {
      throw new ZipError('The zip directory is damaged.')
    }

    const cd = await readAt(fd, cdStart, cdSize)
    const items: ZipItem[] = []
    let at = 0
    for (let n = 0; n < count; n++) {
      if (cd.readUInt32LE(at) !== 0x02014b50) throw new ZipError('The zip directory is damaged.')
      const flags = cd.readUInt16LE(at + 8)
      const method = cd.readUInt16LE(at + 10)
      const crc = cd.readUInt32LE(at + 16)
      let csize = cd.readUInt32LE(at + 20)
      let usize = cd.readUInt32LE(at + 24)
      const nameLen = cd.readUInt16LE(at + 28)
      const extraLen = cd.readUInt16LE(at + 30)
      const commentLen = cd.readUInt16LE(at + 32)
      const madeBy = cd.readUInt16LE(at + 4) >> 8
      const attrs = cd.readUInt32LE(at + 38)
      let offset = cd.readUInt32LE(at + 42)
      const rawName = cd.subarray(at + 46, at + 46 + nameLen)
      const name = new TextDecoder(flags & 0x0800 ? 'utf-8' : 'latin1').decode(rawName)
      // zip64 extra: present values replace the 0xffffffff placeholders, in this order.
      let e = at + 46 + nameLen
      const end = e + extraLen
      while (e + 4 <= end) {
        const id = cd.readUInt16LE(e)
        const len = cd.readUInt16LE(e + 2)
        if (id === 0x0001) {
          let p = e + 4
          if (usize === MAX32) {
            usize = Number(cd.readBigUInt64LE(p))
            p += 8
          }
          if (csize === MAX32) {
            csize = Number(cd.readBigUInt64LE(p))
            p += 8
          }
          if (offset === MAX32) offset = Number(cd.readBigUInt64LE(p))
        }
        e += 4 + len
      }
      const mode = madeBy === 3 ? attrs >>> 16 : 0
      const dir = name.endsWith('/') || (mode & 0o170000) === 0o040000 || (attrs & 0x10) !== 0
      items.push({ name, dir, method, crc, csize, usize, offset, mode })
      at = end + commentLen
    }
    return items
  } finally {
    await fd.close()
  }
}

export interface UnzipResult {
  files: number
  bytes: number
  /** Entries left out: links, devices, unsafe names. */
  skipped: string[]
}

/**
 * Unpacks into `dest`. Refuses up front if the declared total passes `maxBytes`, and stops
 * any entry that inflates past its declared size.
 */
export async function unzip(
  file: string,
  dest: string,
  opts: { maxBytes: number; onProgress?: (bytes: number) => void },
): Promise<UnzipResult> {
  const items = await listZip(file)
  const total = items.reduce((n, i) => n + (i.dir ? 0 : i.usize), 0)
  if (total > opts.maxBytes) {
    throw new ZipError(
      `This zip unpacks to more than the ${Math.floor(opts.maxBytes / 2 ** 20)} MB free.`,
    )
  }
  const result: UnzipResult = { files: 0, bytes: 0, skipped: [] }
  const fd = await open(file, 'r')
  try {
    for (const item of items) {
      const rel = safeName(item.name)
      const type = item.mode & 0o170000
      const special = type !== 0 && type !== 0o100000 && type !== 0o040000
      if (!rel || special) {
        result.skipped.push(item.name)
        continue
      }
      const target = join(dest, rel)
      if (item.dir) {
        await mkdir(target, { recursive: true })
        continue
      }
      if (item.method !== 0 && item.method !== 8) {
        throw new ZipError(`${rel} uses a compression method this can't read (${item.method}).`)
      }
      const local = await readAt(fd, item.offset, 30)
      if (local.readUInt32LE(0) !== 0x04034b50) throw new ZipError(`${rel} is damaged.`)
      const start = item.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)
      await mkdir(dirname(target), { recursive: true })

      let crc = 0
      let written = 0
      const check = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          written += chunk.length
          if (written > item.usize) return cb(new ZipError(`${rel} is bigger than it claims.`))
          crc = Bun.hash.crc32(chunk, crc)
          result.bytes += chunk.length
          opts.onProgress?.(result.bytes)
          cb(null, chunk)
        },
      })
      const source = Readable.fromWeb(
        Bun.file(file)
          .slice(start, start + item.csize)
          .stream() as never,
      )
      const exec = item.mode & 0o111 ? 0o770 : 0o660
      const out = createWriteStream(target, { mode: exec })
      await (
        item.method === 8
          ? pipeline(source, createInflateRaw(), check, out)
          : pipeline(source, check, out)
      ).catch((err) => {
        throw err instanceof ZipError ? err : new ZipError(`${rel} is damaged: ${err.message}`)
      })
      if (written !== item.usize || crc >>> 0 !== item.crc >>> 0) {
        throw new ZipError(`${rel} failed its checksum.`)
      }
      result.files++
    }
  } finally {
    await fd.close()
  }
  return result
}
