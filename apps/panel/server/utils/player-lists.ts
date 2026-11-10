import { chmod, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Entry, ListFile } from '../players'

export async function readList(name: string, file: ListFile): Promise<Entry[]> {
  try {
    const parsed = JSON.parse(await readFile(join(serverDir(name), file), 'utf8'))
    return Array.isArray(parsed) ? (parsed as Entry[]) : []
  } catch {
    return []
  }
}

export async function writeList(name: string, file: ListFile, list: Entry[]) {
  const path = join(serverDir(name), file)
  await writeFile(`${path}.flytower`, JSON.stringify(list, null, 2) + '\n')
  await chmod(`${path}.flytower`, 0o660)
  await rename(`${path}.flytower`, path)
}

/** The server's usercache.json (name to UUID for everyone who has joined), or []. */
export async function readUserCache(name: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(serverDir(name), 'usercache.json'), 'utf8'))
  } catch {
    return []
  }
}
