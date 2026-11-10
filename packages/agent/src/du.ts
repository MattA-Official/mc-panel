/**
 * Disk use, the same way as `crates/flytower-du` and the panel's `server/disk.ts`: the space
 * files really take (allocated blocks), symlinks never followed, a hard-linked file counted
 * once per call, and a folder that can't be read counted as unreadable rather than failing.
 * Walks never cross into another filesystem, so a mount point under a folder isn't counted.
 *
 * The release ships `flytower-du` next to Bun, which is many times faster; this walk is used
 * when it isn't there (development) or fails.
 */
import { existsSync } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface Measured {
  bytes: number
  unreadable: number
}

/** Measures each path in turn, counting a hard-linked file once across all of them. */
export type MeasureMany = (paths: string[]) => Promise<Measured[]>

const onDisk = (s: { blocks?: number; size: number }) =>
  typeof s.blocks === 'number' && s.blocks >= 0 ? s.blocks * 512 : s.size

async function measure(path: string, seen: Set<string>): Promise<Measured> {
  const out: Measured = { bytes: 0, unreadable: 0 }
  let rootDev: number | null = null
  const walk = async (p: string) => {
    let s
    try {
      s = await lstat(p)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') out.unreadable++
      return
    }
    if (s.isSymbolicLink()) return
    rootDev ??= s.dev
    // A mount point under the path: like `du -x`, skipped entirely.
    if (s.dev !== rootDev) return
    if (!s.isDirectory()) {
      if (s.nlink > 1) {
        const id = `${s.dev}:${s.ino}`
        if (seen.has(id)) return
        seen.add(id)
      }
      out.bytes += onDisk(s)
      return
    }
    out.bytes += onDisk(s)
    let names: string[]
    try {
      names = await readdir(p)
    } catch {
      out.unreadable++
      return
    }
    for (const name of names) await walk(join(p, name))
  }
  await walk(path)
  return out
}

export const measureInTs: MeasureMany = async (paths) => {
  const seen = new Set<string>()
  const out: Measured[] = []
  for (const p of paths) out.push(await measure(p, seen))
  return out
}

/** The Rust walker, with `--one-file-system`. Throws if it fails or answers oddly. */
export function measureWithBinary(bin: string): MeasureMany {
  return async (paths) => {
    const proc = Bun.spawn([bin, '--one-file-system', '--', ...paths], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (code !== 0) throw new Error(`flytower-du exited with ${code}: ${err.trim()}`)
    const parsed = JSON.parse(out) as { version?: unknown; results?: Measured[] }
    if (parsed.version !== 1 || parsed.results?.length !== paths.length) {
      throw new Error("flytower-du's answer isn't one this agent understands")
    }
    return parsed.results
  }
}

/** Where the Rust walker is in a release: next to Bun. */
export const duBinary = () =>
  process.env.FLYTOWER_DU || join(dirname(process.execPath), 'flytower-du')

let warned = false

/** The Rust walker when `bin` exists, and the TypeScript walk otherwise. */
export function measurer(bin: string | null): MeasureMany {
  return async (paths) => {
    if (paths.length === 0) return []
    if (bin && existsSync(bin)) {
      try {
        return await measureWithBinary(bin)(paths)
      } catch (err) {
        if (!warned) console.error('flytower-du failed; measuring the slower way', err)
        warned = true
      }
    }
    return measureInTs(paths)
  }
}
