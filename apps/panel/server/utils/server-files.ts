import { join } from 'node:path'
import { readNoFollow, replaceFile, resolveInside } from '../files'
import { isSafeLevelName } from '../../shared/spec'
import { parseProperties, setProperties, stringifyProperties, toRecord } from '../properties'

export const serverDir = (name: string) => join(useRuntimeConfig().serversDir, name)

const propertiesPath = (name: string) => join(serverDir(name), 'server.properties')

export async function readProperties(name: string): Promise<Record<string, string>> {
  const text = (await readNoFollow(propertiesPath(name)).catch(() => null)) ?? ''
  return toRecord(parseProperties(text))
}

/**
 * Changes some properties in place, keeping everything else in the file as it was. Written
 * to a temporary file and renamed, group-writable so the server can still update it.
 */
export async function writeProperties(name: string, changes: Record<string, string>) {
  const path = propertiesPath(name)
  const text = (await readNoFollow(path).catch(() => null)) ?? ''
  await replaceFile(path, stringifyProperties(setProperties(parseProperties(text), changes)))
}

/**
 * The server's world folder (its level-name), absolute. Null when the name is unusual or the
 * folder is a link, since the server process can change both.
 */
export async function worldDir(name: string): Promise<string | null> {
  const level = (await readProperties(name))['level-name'] || 'world'
  if (!isSafeLevelName(level)) return null
  return resolveInside(serverDir(name), level).catch(() => null)
}
