/**
 * File operations confined to one server folder. Every path is resolved and checked, and
 * symlinks are never followed, so nothing outside the folder can be read or changed.
 */
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export class FileError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'FileError'
  }
}

export const MAX_TEXT_BYTES = 2 * 1024 * 1024

const inside = (root: string, p: string) => p === root || p.startsWith(root + sep)

/** Turns a user path into an absolute one inside `root`, or throws. */
export async function resolveInside(root: string, userPath: string): Promise<string> {
  const realRoot = await realpath(root)
  const cleaned = (userPath ?? '').replace(/\\/g, '/')
  if (isAbsolute(cleaned) && !cleaned.startsWith('/')) throw new FileError(400, 'Bad path.')
  const target = resolve(realRoot, '.' + (cleaned.startsWith('/') ? cleaned : '/' + cleaned))
  if (!inside(realRoot, target)) throw new FileError(400, "That's outside the server folder.")

  // Walk up to the nearest thing that exists and make sure no symlink leads out.
  let probe = target
  for (;;) {
    const st = await lstat(probe).catch(() => null)
    if (st) {
      if (st.isSymbolicLink() && probe !== realRoot) {
        throw new FileError(400, 'Symbolic links are shown but not followed.')
      }
      const real = await realpath(probe)
      if (!inside(realRoot, real)) throw new FileError(400, "That's outside the server folder.")
      break
    }
    probe = dirname(probe)
  }
  // No ancestor of the target may be a symlink either.
  for (let p = dirname(target); inside(realRoot, p) && p !== realRoot; p = dirname(p)) {
    const st = await lstat(p).catch(() => null)
    if (st?.isSymbolicLink()) throw new FileError(400, 'Symbolic links are shown but not followed.')
  }
  return target
}

export interface Entry {
  name: string
  type: 'file' | 'dir' | 'link' | 'other'
  size: number
  modified: number
}

export async function list(root: string, path: string): Promise<Entry[]> {
  const dir = await resolveInside(root, path)
  const st = await lstat(dir).catch(() => null)
  if (!st) throw new FileError(404, 'No such folder.')
  if (!st.isDirectory()) throw new FileError(400, "That's a file, not a folder.")
  const names = await readdir(dir)
  const entries = await Promise.all(
    names.map(async (name): Promise<Entry | null> => {
      const s = await lstat(join(dir, name)).catch(() => null)
      if (!s) return null
      const type = s.isSymbolicLink()
        ? 'link'
        : s.isDirectory()
          ? 'dir'
          : s.isFile()
            ? 'file'
            : 'other'
      return { name, type, size: s.isFile() ? s.size : 0, modified: s.mtimeMs }
    }),
  )
  return entries
    .filter((e): e is Entry => !!e)
    .sort((a, b) =>
      a.type === 'dir' && b.type !== 'dir'
        ? -1
        : b.type === 'dir' && a.type !== 'dir'
          ? 1
          : a.name.localeCompare(b.name),
    )
}

async function fileAt(root: string, path: string) {
  const file = await resolveInside(root, path)
  const st = await lstat(file).catch(() => null)
  if (!st) throw new FileError(404, 'No such file.')
  if (!st.isFile()) throw new FileError(400, "That isn't a file.")
  return { file, size: st.size }
}

export async function readText(root: string, path: string): Promise<string> {
  const { file, size } = await fileAt(root, path)
  if (size > MAX_TEXT_BYTES) throw new FileError(413, 'Too big to edit here. Download it instead.')
  const bytes = await Bun.file(file).bytes()
  if (bytes.includes(0)) throw new FileError(415, "That's not a text file. Download it instead.")
  return new TextDecoder().decode(bytes)
}

/** The real path of a file to stream back, after the same checks. */
export async function downloadPath(root: string, path: string) {
  return fileAt(root, path)
}

/** Writes via a temporary file and rename, group-writable so the server can use it. */
export async function writeAtomic(root: string, path: string, data: string | Response) {
  const file = await resolveInside(root, path)
  if (file === (await realpath(root))) throw new FileError(400, 'Pick a file name.')
  const st = await lstat(file).catch(() => null)
  if (st && !st.isFile()) throw new FileError(400, "That isn't a file.")
  const parent = await lstat(dirname(file)).catch(() => null)
  if (!parent?.isDirectory()) throw new FileError(404, 'That folder does not exist.')
  const tmp = join(dirname(file), `.${basename(file)}.flytower-${process.pid}-${Date.now()}`)
  try {
    if (typeof data === 'string') await writeFile(tmp, data)
    else await Bun.write(tmp, data)
    await chmod(tmp, 0o660)
    await rename(tmp, file)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

export async function makeDir(root: string, path: string) {
  const dir = await resolveInside(root, path)
  if (await lstat(dir).catch(() => null))
    throw new FileError(409, 'Something with that name exists.')
  await mkdir(dir)
  await chmod(dir, 0o2770)
}

export async function move(root: string, from: string, to: string) {
  const realRoot = await realpath(root)
  const src = await resolveInside(root, from)
  const dest = await resolveInside(root, to)
  if (src === realRoot || dest === realRoot)
    throw new FileError(400, "The server folder itself can't move.")
  if (!(await lstat(src).catch(() => null))) throw new FileError(404, 'No such file.')
  if (await lstat(dest).catch(() => null))
    throw new FileError(409, 'Something with that name exists.')
  if (inside(src, dest)) throw new FileError(400, "A folder can't move inside itself.")
  await rename(src, dest)
}

export async function remove(root: string, path: string) {
  const realRoot = await realpath(root)
  const target = await resolveInside(root, path)
  if (target === realRoot) throw new FileError(400, "The server folder itself can't be deleted.")
  if (!(await lstat(target).catch(() => null))) throw new FileError(404, 'No such file.')
  await rm(target, { recursive: true, force: true })
}

/** For audit entries and messages: the path relative to the server folder. */
export const display = async (root: string, abs: string) =>
  '/' + relative(await realpath(root), abs)

/** True when the first bytes look like text. Used before sending a file to the editor. */
export async function looksBinary(file: string): Promise<boolean> {
  const fh = await open(file, 'r')
  try {
    const buf = new Uint8Array(8192)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    return buf.subarray(0, bytesRead).includes(0)
  } finally {
    await fh.close()
  }
}
