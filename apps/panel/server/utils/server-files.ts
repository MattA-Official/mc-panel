import { chmod, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseProperties, setProperties, stringifyProperties, toRecord } from '../properties'

export const serverDir = (name: string) => join(useRuntimeConfig().serversDir, name)

const propertiesPath = (name: string) => join(serverDir(name), 'server.properties')

export async function readProperties(name: string): Promise<Record<string, string>> {
  const text = await readFile(propertiesPath(name), 'utf8').catch(() => '')
  return toRecord(parseProperties(text))
}

/**
 * Changes some properties in place, keeping everything else in the file as it was. Written
 * to a temporary file and renamed, group-writable so the server can still update it.
 */
export async function writeProperties(name: string, changes: Record<string, string>) {
  const path = propertiesPath(name)
  const text = await readFile(path, 'utf8').catch(() => '')
  const next = stringifyProperties(setProperties(parseProperties(text), changes))
  await writeFile(`${path}.flytower`, next)
  await chmod(`${path}.flytower`, 0o660)
  await rename(`${path}.flytower`, path)
}
