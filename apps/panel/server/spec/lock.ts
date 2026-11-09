/**
 * The lockfile: exactly which files a server's spec installed, by URL and hash. It lives in
 * the server folder as flytower.lock.json so it travels with backups and moves.
 */
import { chmod, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

export const LOCK_FILE = 'flytower.lock.json'

const LockedItem = z.object({
  source: z.enum(['modrinth', 'url']),
  projectId: z.string(),
  slug: z.string(),
  title: z.string(),
  versionId: z.string(),
  versionNumber: z.string(),
  kind: z.enum(['mod', 'datapack']),
  /** Relative to the server folder, like "mods/lithium.jar" or "world/datapacks/x.zip". */
  path: z.string(),
  url: z.string(),
  sha256: z.string(),
  sha512: z.string().optional(),
  size: z.number().nullable(),
  requiredBy: z.array(z.string()),
})
export type LockedItem = z.infer<typeof LockedItem>

const Lock = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  content: z.array(LockedItem),
})
export type Lock = z.infer<typeof Lock>

export const emptyLock = (): Lock => ({
  version: 1,
  updatedAt: new Date(0).toISOString(),
  content: [],
})

export class LockError extends Error {
  override name = 'LockError'
}

export async function readLock(dir: string): Promise<Lock> {
  const text = await readFile(join(dir, LOCK_FILE), 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null
    throw err
  })
  if (text === null) return emptyLock()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new LockError(`${LOCK_FILE} is damaged. Fix or delete it in the file manager.`)
  }
  const lock = Lock.safeParse(parsed)
  if (!lock.success) {
    throw new LockError(`${LOCK_FILE} isn't one Flytower understands. Fix or delete it.`)
  }
  return lock.data
}

export async function writeLock(dir: string, lock: Lock) {
  const path = join(dir, LOCK_FILE)
  const body = `${JSON.stringify({ ...lock, content: [...lock.content].sort(byPath) }, null, 2)}\n`
  await writeFile(`${path}.tmp`, body)
  await chmod(`${path}.tmp`, 0o660)
  await rename(`${path}.tmp`, path)
}

const byPath = (a: LockedItem, b: LockedItem) => a.path.localeCompare(b.path)

/** Where each kind of content goes inside the server folder. */
export function contentDir(kind: LockedItem['kind'], levelName: string) {
  return kind === 'mod' ? 'mods' : `${levelName}/datapacks`
}

/**
 * Files in the content folders that the lockfile doesn't know about: put there by hand, so
 * they're shown and left alone.
 */
export async function unmanagedFiles(dir: string, lock: Lock, levelName: string) {
  const known = new Set(lock.content.map((c) => c.path))
  const out: { path: string; kind: LockedItem['kind'] }[] = []
  for (const kind of ['mod', 'datapack'] as const) {
    const sub = contentDir(kind, levelName)
    const names = await readdir(join(dir, sub)).catch(() => [] as string[])
    for (const name of names.sort()) {
      const path = `${sub}/${name}`
      const fits =
        kind === 'mod' ? /\.jar$/i.test(name) : /\.zip$/i.test(name) || !name.includes('.')
      if (fits && !known.has(path)) out.push({ path, kind })
    }
  }
  return out
}
