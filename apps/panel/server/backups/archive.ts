/**
 * tar + zstd without extra packages: system tar for the file walk (it keeps modes and
 * handles every odd file name), Bun's streaming zstd for compression.
 */
import { createReadStream, createWriteStream } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createZstdCompress, createZstdDecompress } from 'node:zlib'

/** Folders inside a server that are never worth backing up. */
export const EXCLUDE = ['./logs', './crash-reports', './.flytower-restore']

async function finished(proc: { exited: Promise<number>; stderr: ReadableStream }, what: string) {
  const code = await proc.exited
  // GNU tar exits 1 when a file changed while being read; with saving paused that is a log
  // or similar, so the archive is still good.
  if (code !== 0 && code !== 1) {
    const err = (await new Response(proc.stderr).text()).trim()
    throw new Error(`${what} failed: ${err || `exit ${code}`}`)
  }
}

/** Archives the contents of `dir` into `dest` (written to `.partial`, then renamed). */
export async function createArchive(dir: string, dest: string): Promise<{ bytes: number }> {
  const partial = `${dest}.partial`
  const proc = Bun.spawn(
    ['tar', '-cf', '-', ...EXCLUDE.map((e) => `--exclude=${e}`), '-C', dir, '.'],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  try {
    await pipeline(
      Readable.fromWeb(proc.stdout as never),
      createZstdCompress(),
      createWriteStream(partial, { mode: 0o640 }),
    )
    await finished(proc, 'Archiving')
    await rename(partial, dest)
  } catch (err) {
    proc.kill()
    await rm(partial, { force: true })
    throw err
  }
  return { bytes: (await stat(dest)).size }
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
  try {
    await pipeline(createReadStream(file), createZstdDecompress(), toTar)
  } catch (err) {
    proc.kill()
    throw new Error(`Couldn't read the backup: ${(err as Error).message}`, { cause: err })
  }
  await finished(proc, 'Unpacking')
}
