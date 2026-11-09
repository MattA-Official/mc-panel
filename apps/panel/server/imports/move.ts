/** Moving imported files into a new server folder, and back again if the import fails. */
import { readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

export interface ImportSource {
  /** The server folder or world folder inside staging. */
  root: string
  kind: 'server' | 'world'
}

/**
 * Left behind from a server folder: caches the server rebuilds, old logs, and any jar (the
 * server jar is downloaded fresh; Fabric's launcher is replaced by it).
 */
export function skipped(name: string) {
  return (
    name.endsWith('.jar') ||
    ['libraries', 'versions', '.fabric', 'logs', 'crash-reports', 'eula.txt', '__MACOSX'].includes(
      name,
    )
  )
}

/** rename, or copy and delete when staging and servers are on different disks. */
async function move(from: string, to: string) {
  try {
    await rename(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    const cp = Bun.spawn(['cp', '-a', '--', from, to], { stderr: 'pipe' })
    if ((await cp.exited) !== 0) {
      throw new Error(`Copying ${from} failed: ${(await new Response(cp.stderr).text()).trim()}`)
    }
    await rm(from, { recursive: true, force: true })
  }
}

/** Moves what's worth keeping into `dir`. Returns the names moved, for moveBack. */
export async function moveIn(source: ImportSource, dir: string): Promise<string[]> {
  if (source.kind === 'world') {
    await move(source.root, join(dir, 'world'))
    return ['world']
  }
  const moved: string[] = []
  for (const name of await readdir(source.root)) {
    if (skipped(name)) continue
    await move(join(source.root, name), join(dir, name))
    moved.push(name)
  }
  return moved
}

export async function moveBack(source: ImportSource, dir: string, moved: string[]) {
  if (source.kind === 'world') return move(join(dir, 'world'), source.root)
  for (const name of moved) await move(join(dir, name), join(source.root, name))
}
