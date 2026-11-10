/**
 * Reading what a crash left behind in a server's folder: Minecraft's crash report, Java's
 * own error file, and the end of the log. Read before the next start rotates the log.
 */
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface CrashReport {
  /** Relative to the server folder, like `crash-reports/crash-2026-11-09_21.04.11-server.txt`. */
  path: string
  /** The report's "Description:" line, like "Exception ticking world". */
  description: string | null
  /** A JVM error file (hs_err_pid…log) rather than a Minecraft crash report. */
  java: boolean
}

const MC_REPORT = /^crash-.*\.txt$/
const JVM_REPORT = /^hs_err_pid\d+\.log$/

async function newest(dir: string, pattern: RegExp, sinceMs: number) {
  const names = await readdir(dir).catch(() => [] as string[])
  let best: { name: string; mtime: number } | null = null
  for (const name of names) {
    if (!pattern.test(name)) continue
    const st = await stat(join(dir, name)).catch(() => null)
    if (!st?.isFile() || st.mtimeMs < sinceMs) continue
    if (!best || st.mtimeMs > best.mtime) best = { name, mtime: st.mtimeMs }
  }
  return best?.name ?? null
}

/** Reads up to `bytes` from the start or the end of a file. */
async function readPart(path: string, bytes: number, fromEnd: boolean): Promise<string> {
  const fh = await open(path, 'r')
  try {
    const { size } = await fh.stat()
    const length = Math.min(size, bytes)
    const buf = Buffer.alloc(length)
    await fh.read(buf, 0, length, fromEnd ? size - length : 0)
    return buf.toString('utf8')
  } finally {
    await fh.close()
  }
}

/** Pulls the description out of a Minecraft crash report. */
export function parseDescription(text: string): string | null {
  const m = /^Description: (.+)$/m.exec(text)
  return m ? m[1]!.trim().slice(0, 200) : null
}

/** The newest crash report written since `sinceMs`, if any. */
export async function findCrashReport(dir: string, sinceMs: number): Promise<CrashReport | null> {
  const mc = await newest(join(dir, 'crash-reports'), MC_REPORT, sinceMs)
  if (mc) {
    const path = `crash-reports/${mc}`
    const head = await readPart(join(dir, path), 4096, false).catch(() => '')
    return { path, description: parseDescription(head), java: false }
  }
  const jvm = await newest(dir, JVM_REPORT, sinceMs)
  return jvm ? { path: jvm, description: null, java: true } : null
}

/** The last `lines` lines of logs/latest.log, or none if there isn't one. */
export async function readLogTail(dir: string, lines = 50): Promise<string[]> {
  const text = await readPart(join(dir, 'logs', 'latest.log'), 64 * 1024, true).catch(() => '')
  const all = text.split('\n')
  if (all.at(-1) === '') all.pop()
  // The first line may be cut part-way through.
  if (text.length >= 64 * 1024) all.shift()
  return all.slice(-lines).map((l) => (l.length > 1000 ? `${l.slice(0, 1000)}…` : l))
}
