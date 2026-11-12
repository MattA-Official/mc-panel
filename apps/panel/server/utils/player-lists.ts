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

/** Reads a list, changes it and writes it back, one change to each file at a time. */
export function updateList(name: string, file: ListFile, change: (list: Entry[]) => Entry[]) {
  return editInTurn(join(serverDir(name), file), async () =>
    writeList(name, file, change(await readList(name, file))),
  )
}

/** The server's usercache.json (name to UUID for everyone who has joined), or []. */
export async function readUserCache(name: string): Promise<unknown> {
  try {
    return JSON.parse((await readNoFollow(join(serverDir(name), 'usercache.json'))) ?? '[]')
  } catch {
    return []
  }
}
