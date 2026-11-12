/**
 * Read-only access to a server's logs folder: the live latest.log and the rotated,
 * gzipped days before it.
 */
import { lstat, readdir } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'
import { FileError, resolveInside } from './files'

export const LOG_NAME = /^[\w.-]+\.log(\.gz)?$/
export const MAX_LOG_BYTES = 32 * 1024 * 1024
export const MAX_LINES = 5000

export interface LogFile {
  name: string
  size: number
  modified: number
  live: boolean
}

export async function listLogs(root: string): Promise<LogFile[]> {
  const dir = await resolveInside(root, '/logs')
  const names = await readdir(dir).catch(() => [] as string[])
  const files = await Promise.all(
    names
      .filter((n) => LOG_NAME.test(n))
      .map(async (name): Promise<LogFile | null> => {
        const st = await lstat(join(dir, name)).catch(() => null)
        if (!st?.isFile()) return null
        return { name, size: st.size, modified: st.mtimeMs, live: name === 'latest.log' }
      }),
  )
  return files
    .filter((f): f is LogFile => f !== null)
    .sort((a, b) => Number(b.live) - Number(a.live) || b.modified - a.modified)
}

/** The path of one log, checked. */
export async function logPath(root: string, name: string) {
  if (!LOG_NAME.test(name)) throw new FileError(400, "That isn't a log file.")
  const path = await resolveInside(root, `/logs/${name}`)
  const st = await lstat(path).catch(() => null)
  if (!st?.isFile()) throw new FileError(404, 'No such log.')
  return { path, size: st.size }
}

export interface LogView {
  lines: string[]
  /** Lines in the whole log. */
  total: number
  /** Lines that matched the search (equal to total with no search). */
  matched: number
  /** True when only the last MAX_LINES matches are returned. */
  truncated: boolean
}

export async function readLog(root: string, name: string, query = ''): Promise<LogView> {
  const { path, size } = await logPath(root, name)
  const gz = name.endsWith('.gz')
  if (!gz && size > MAX_LOG_BYTES)
    throw new FileError(413, 'This log is too big to show. Download it instead.')
  if (gz && size > MAX_LOG_BYTES)
    throw new FileError(413, 'This log is too big to show. Download it instead.')
  let bytes: Uint8Array = new Uint8Array(await Bun.file(path).arrayBuffer())
  if (gz) {
    // Unpacking stops at the cap, so a small archive that unpacks to gigabytes is refused
    // before it can use the memory.
    try {
      bytes = gunzipSync(bytes, { maxOutputLength: MAX_LOG_BYTES })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE')
        throw new FileError(413, 'This log is too big to show. Download it instead.')
      throw new FileError(415, "This log isn't valid gzip.")
    }
  }
  const text = new TextDecoder().decode(bytes)
  const all = text.split(/\r?\n/)
  if (all.at(-1) === '') all.pop()
  const q = query.trim().toLowerCase()
  const hits = q ? all.filter((l) => l.toLowerCase().includes(q)) : all
  return {
    lines: hits.slice(-MAX_LINES),
    total: all.length,
    matched: hits.length,
    truncated: hits.length > MAX_LINES,
  }
}
