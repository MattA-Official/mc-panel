import { join } from 'node:path'
import { readNoFollow, replaceFile } from '../files'
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
