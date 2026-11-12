/**
 * Works out what an unpacked upload is: a server folder or a bare world, which loader and
 * Minecraft version, and anything we can't run yet.
 */
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseProperties, toRecord } from '../properties'
import { MAX_BYTES as MAX_NBT_BYTES, readNbt, worldVersion } from './nbt'

export interface Detected {
  /** Path of the server or world inside the staging folder. */
  root: string
  kind: 'server' | 'world'
  loader: 'vanilla' | 'fabric' | 'paper'
  loaderVersion: string | null
  mcVersion: string | null
  /** The world folder's name inside a server (level-name). */
  levelName: string
  worldFound: boolean
  hasMods: boolean
  /** Set when this is something Flytower can't run yet, e.g. Forge. */
  unsupported: string | null
  warnings: string[]
}

const MARKERS = [
  'server.properties',
  'level.dat',
  'eula.txt',
  'mods',
  'libraries',
  'versions',
  'world',
  'whitelist.json',
  'ops.json',
]
const IGNORE = new Set(['__MACOSX', '.DS_Store'])

const exists = async (p: string) => !!(await lstat(p).catch(() => null))
const isDir = async (p: string) => !!(await lstat(p).catch(() => null))?.isDirectory()
const names = async (p: string) =>
  (await readdir(p).catch(() => [] as string[])).filter((n) => !IGNORE.has(n))

/** Compares dotted versions numerically, so 0.18.10 beats 0.18.9. */
export function compareVersions(a: string, b: string) {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10))
  const pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}
const newest = (list: string[]) => [...list].sort(compareVersions).at(-1) ?? null

/** Steps into a lone wrapper folder until something that looks like a server or world. */
export async function findRoot(dir: string): Promise<string> {
  let root = dir
  for (let depth = 0; depth < 4; depth++) {
    const entries = await names(root)
    if (entries.some((n) => MARKERS.includes(n) || n.endsWith('.jar'))) return root
    if (entries.length === 1 && (await isDir(join(root, entries[0]!)))) {
      root = join(root, entries[0]!)
      continue
    }
    return root
  }
  return root
}

async function levelVersion(levelDat: string) {
  try {
    if ((await lstat(levelDat)).size > MAX_NBT_BYTES) return null
    return worldVersion(readNbt(new Uint8Array(await readFile(levelDat)))).name
  } catch {
    return null
  }
}

export async function detect(dir: string): Promise<Detected> {
  const root = await findRoot(dir)
  const warnings: string[] = []
  const lib = (...p: string[]) => join(root, 'libraries', ...p)

  // A bare world: level.dat at the top.
  if (await exists(join(root, 'level.dat'))) {
    return {
      root,
      kind: 'world',
      loader: 'vanilla',
      loaderVersion: null,
      mcVersion: await levelVersion(join(root, 'level.dat')),
      levelName: 'world',
      worldFound: true,
      hasMods: false,
      unsupported: null,
      warnings,
    }
  }

  const top = await names(root)
  const props = toRecord(
    parseProperties(await readFile(join(root, 'server.properties'), 'utf8').catch(() => '')),
  )
  const levelName = props['level-name'] || 'world'
  const worldFound = await exists(join(root, levelName, 'level.dat'))

  let unsupported: string | null = null
  // Paper and the Bukkit family it grew from all run on Paper.
  const paper =
    top.some((n) => /^(bukkit|spigot|paper.*|purpur)\.yml$/.test(n) || /^paper.*\.jar$/.test(n)) ||
    (await exists(join(root, 'config', 'paper-global.yml')))
  if (paper) {
    if (
      !top.some((n) => /^paper/.test(n)) &&
      !(await exists(join(root, 'config', 'paper-global.yml')))
    ) {
      warnings.push(
        "This looks like Spigot or Purpur. It'll run on Paper, which reads the same worlds and plugins.",
      )
    }
  } else if (await exists(lib('net', 'neoforged'))) unsupported = 'NeoForge'
  else if (await exists(lib('net', 'minecraftforge'))) unsupported = 'Forge'
  else if (await exists(lib('org', 'quiltmc'))) unsupported = 'Quilt'

  const fabricLoaders = await names(lib('net', 'fabricmc', 'fabric-loader'))
  const fabric =
    fabricLoaders.length > 0 ||
    top.includes('.fabric') ||
    top.includes('fabric-server-launcher.properties') ||
    top.includes('fabric-server-launch.jar')

  const mods = (await names(join(root, 'mods'))).filter((n) => n.endsWith('.jar'))
  if (mods.length && !fabric && !paper && !unsupported) {
    warnings.push(
      "There's a mods folder but no sign of Fabric. Pick Fabric below if these are Fabric mods.",
    )
  }

  let mcVersion = worldFound ? await levelVersion(join(root, levelName, 'level.dat')) : null
  mcVersion ??= newest(await names(join(root, 'versions')))
  mcVersion ??= newest(await names(lib('net', 'fabricmc', 'intermediary')))
  if (!worldFound) warnings.push(`No world found in "${levelName}". A new one will be made.`)

  return {
    root,
    kind: 'server',
    loader: paper ? 'paper' : fabric ? 'fabric' : 'vanilla',
    loaderVersion: paper ? null : newest(fabricLoaders),
    mcVersion,
    levelName,
    worldFound,
    hasMods: mods.length > 0,
    unsupported,
    warnings,
  }
}
