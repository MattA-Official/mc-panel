/**
 * Files the agent writes as root. Its own folders must be ones only it can change, and nothing
 * here follows a symlink, so a path someone else planted can't redirect a write or a copy.
 * `crates/flytower-agent/src/safe_fs.rs` does the same.
 */
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'

const { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW, O_NONBLOCK } = constants

/** Who the agent runs as: root in production, whoever runs the tests otherwise. */
const me = () => process.getuid?.() ?? 0

/** The largest state file read back (ssh.json, update.json). */
const SMALL = 64 * 1024

/**
 * Makes `dir` if it's missing and checks it's a real folder owned by the agent's user, then
 * sets its mode. A symlink, or a folder someone else owns, is refused rather than used.
 */
export async function ownDir(dir: string, mode: number) {
  await mkdir(dir, { recursive: true, mode })
  const s = await lstat(dir)
  if (!s.isDirectory() || s.uid !== me()) {
    throw new Error(`${dir} isn't a folder owned by ${me() === 0 ? 'root' : 'the agent'}`)
  }
  if ((s.mode & 0o7777) !== mode) await chmod(dir, mode)
}

/** Writes a whole file through a new temporary file renamed over it. */
export async function writeAtomic(path: string, text: string, mode = 0o600) {
  const tmp = `${path}.tmp-${randomBytes(6).toString('hex')}`
  const fh = await open(tmp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, mode)
  try {
    await fh.writeFile(text)
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await rename(tmp, path)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

/** A small regular file's text, or null if it's missing, too big, or not a regular file. */
export async function readSmall(path: string): Promise<string | null> {
  const fh = await open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK).catch(() => null)
  if (!fh) return null
  try {
    const s = await fh.stat()
    if (!s.isFile() || s.size > SMALL) return null
    return await fh.readFile('utf8')
  } catch {
    return null
  } finally {
    await fh.close()
  }
}

export interface Owner {
  uid: number
  gid: number
  mode: number
}

/** What a copied file was: its owner and mode, and when it was last changed. */
export interface Copied extends Owner {
  mtime: Date
}

/**
 * Copies a regular file without following a symlink at either end. Whatever is at `dest` is
 * removed and the copy made anew there, so it's never written through. The copy is given
 * `owner`, or keeps the source's, and the source's modified time. Returns the source's details.
 */
export async function copyFile(src: string, dest: string, owner?: Owner): Promise<Copied> {
  // O_NONBLOCK so a FIFO planted in place of a file can't hang the agent.
  const from = await open(src, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
  try {
    const s = await from.stat()
    if (!s.isFile()) throw new Error(`${src} isn't a regular file`)
    await rm(dest, { force: true })
    const to = await open(dest, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    try {
      const buf = Buffer.allocUnsafe(1 << 20)
      let at = 0
      for (;;) {
        const { bytesRead } = await from.read(buf, 0, buf.length, at)
        if (bytesRead === 0) break
        let done = 0
        while (done < bytesRead) {
          const { bytesWritten } = await to.write(buf, done, bytesRead - done, at + done)
          done += bytesWritten
        }
        at += bytesRead
      }
      const o = owner ?? { uid: s.uid, gid: s.gid, mode: s.mode }
      if (me() === 0) await to.chown(o.uid, o.gid)
      await to.chmod(o.mode & 0o7777)
      await to.utimes(s.atime, s.mtime)
      await to.sync()
    } finally {
      await to.close()
    }
    return { uid: s.uid, gid: s.gid, mode: s.mode, mtime: s.mtime }
  } finally {
    await from.close()
  }
}
