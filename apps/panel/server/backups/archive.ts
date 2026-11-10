/**
 * tar + zstd without extra packages: system tar for the file walk (it keeps modes and
 * handles every odd file name), Bun's streaming zstd for compression.
 */
import { createReadStream, createWriteStream } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createZstdCompress, createZstdDecompress } from 'node:zlib'
import { TILE_DIRS } from '../map/squaremap'

/** Folders inside a server that are never worth backing up. */
export const EXCLUDE = [
  './logs',
  './crash-reports',
  './.flytower-restore',
  // spark's profiler scratch space: Java makes these files readable by their owner only.
  './config/spark/tmp',
  // The web map's tiles: squaremap draws them again from the world.
  ...TILE_DIRS,
]

/** File names that are never worth backing up, wherever they are: half-written temp files. */
export const EXCLUDE_NAMES = ['*.tmp']

/** True when `rel` (a path inside the server folder, without `./`) is skipped by backups. */
export function isExcluded(rel: string): boolean {
  if (EXCLUDE.some((e) => rel === e.slice(2))) return true
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  return EXCLUDE_NAMES.some((p) => new Bun.Glob(p).match(name))
}

// What tar says about a file it had to leave out, e.g.
// `tar: ./config/x.jfr: Warning: Cannot open: Permission denied`.
const SKIPPED =
  /^tar: (.+?): (?:Warning: )?(?:Cannot open|Cannot stat|Cannot read|Read error[^:]*|File removed before we read it)(?:: (.+))?$/

/** Files tar warned about and left out, as `path (reason)`, from its stderr. */
export function skippedFiles(stderr: string): string[] {
  const out: string[] = []
  for (const line of stderr.split('\n')) {
    const m = SKIPPED.exec(line.trim())
    if (m) out.push(`${m[1]!.replace(/^\.\//, '')}${m[2] ? ` (${m[2]})` : ''}`)
  }
  return out
}

async function finished(proc: { exited: Promise<number> }, stderr: Promise<string>, what: string) {
  const code = await proc.exited
  const err = (await stderr).trim()
  // GNU tar exits 1 when a file changed while being read; with saving paused that is a log
  // or similar, so the archive is still good.
  if (code !== 0 && code !== 1) throw new Error(`${what} failed: ${err || `exit ${code}`}`)
  return err
}

/**
 * Archives the contents of `dir` into `dest` (written to `.partial`, then renamed).
 * A file that can't be read, such as another program's private temp file, is left out
 * rather than failing the whole backup; `skipped` lists any.
 */
export async function createArchive(
  dir: string,
  dest: string,
): Promise<{ bytes: number; skipped: string[] }> {
  const partial = `${dest}.partial`
  const proc = Bun.spawn(
    [
      'tar',
      '-cf',
      '-',
      '--ignore-failed-read',
      ...EXCLUDE.map((e) => `--exclude=${e}`),
      ...EXCLUDE_NAMES.map((e) => `--exclude=${e}`),
      '-C',
      dir,
      '.',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  // Read stderr as tar runs, so a long list of warnings can't fill the pipe and stall it.
  const stderr = new Response(proc.stderr).text()
  let warnings: string
  try {
    await pipeline(
      Readable.fromWeb(proc.stdout as never),
      createZstdCompress(),
      createWriteStream(partial, { mode: 0o640 }),
    )
    warnings = await finished(proc, stderr, 'Archiving')
    await rename(partial, dest)
  } catch (err) {
    proc.kill()
    await rm(partial, { force: true })
    throw err
  }
  return { bytes: (await stat(dest)).size, skipped: skippedFiles(warnings) }
}

/** Unpacks an archive made by createArchive into `dir`, which should be empty. */
export async function extractArchive(file: string, dir: string): Promise<void> {
  const proc = Bun.spawn(['tar', '-xf', '-', '--no-same-owner', '--no-overwrite-dir', '-C', dir], {
    stdin: 'pipe',
    stdout: 'ignore',
    stderr: 'pipe',
  })
  const sink = proc.stdin
  const toTar = new Writable({
    write(chunk, _enc, cb) {
      Promise.resolve(sink.write(chunk)).then(() => cb(), cb)
    },
    final(cb) {
      Promise.resolve(sink.end()).then(() => cb(), cb)
    },
  })
  const stderr = new Response(proc.stderr).text()
  try {
    await pipeline(createReadStream(file), createZstdDecompress(), toTar)
  } catch (err) {
    proc.kill()
    throw new Error(`Couldn't read the backup: ${(err as Error).message}`, { cause: err })
  }
  await finished(proc, stderr, 'Unpacking')
}
