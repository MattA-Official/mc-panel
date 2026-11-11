import { join } from 'node:path'
import { readNoFollow, replaceFile } from '../files'
import type { Entry, ListFile } from '../players'

export async function readList(name: string, file: ListFile): Promise<Entry[]> {
  try {
    const parsed = JSON.parse((await readNoFollow(join(serverDir(name), file))) ?? '[]')
    return Array.isArray(parsed) ? (parsed as Entry[]) : []
  } catch {
    return []
  }
}

export async function writeList(name: string, file: ListFile, list: Entry[]) {
  await replaceFile(join(serverDir(name), file), JSON.stringify(list, null, 2) + '\n')
}

/** The server's usercache.json (name to UUID for everyone who has joined), or []. */
export async function readUserCache(name: string): Promise<unknown> {
  try {
    return JSON.parse((await readNoFollow(join(serverDir(name), 'usercache.json'))) ?? '[]')
  } catch {
    return []
  }
}
