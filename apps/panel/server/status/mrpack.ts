/**
 * The players' modpack for a server's public page: a Modrinth `.mrpack` that the Modrinth
 * app, Prism and other launchers open as a ready-to-play instance.
 *
 * It lists files by their Modrinth CDN downloads and hashes; nothing is bundled, so Flytower
 * never redistributes anyone's files. From the server it takes each Modrinth mod in the
 * lockfile that runs on players' computers; server-only mods, plugins, datapacks and files
 * from elsewhere stay out. Then it adds the client extras listed in the settings (client
 * mods, shader packs, resource packs) with their required dependencies.
 *
 * Fabric only for now: Paper plugins and vanilla datapacks never go on the player's side.
 */
import {
  CLIENT_KINDS,
  type ClientKind,
  type ModrinthPack,
  type PackFile,
} from '@flytower/providers'
import type { ClientItem } from '../../shared/public-page'
import type { Lock } from '../spec/lock'

export interface PackServer {
  name: string
  displayName: string
  loader: string
  mcVersion: string
  loaderVersion: string | null
}

export interface MrpackFile {
  path: string
  hashes: { sha1: string; sha512: string }
  env: { client: 'required' | 'optional'; server: 'required' | 'optional' | 'unsupported' }
  downloads: string[]
  fileSize: number
}

export interface MrpackIndex {
  formatVersion: 1
  game: 'minecraft'
  versionId: string
  name: string
  summary: string
  files: MrpackFile[]
  dependencies: Record<string, string>
}

export interface PackSummary {
  /** What players get, for the settings card. */
  included: { title: string; kind: ClientKind; version: string; from: 'server' | 'extra' }[]
  /** What was left out, and why. */
  skipped: { title: string; reason: string }[]
}

export interface BuiltPack extends PackSummary {
  index: MrpackIndex
}

/** Why a server can't have a pack at all, or null when it can. */
export function packUnavailable(server: PackServer): string | null {
  if (server.loader !== 'fabric') return 'Modpacks are for Fabric servers.'
  if (!server.loaderVersion) return "The server's Fabric version isn't known yet."
  return null
}

/** Dependencies are followed this many levels deep at most. */
const MAX_DEPTH = 4
/** A pack never lists more files than this. */
const MAX_FILES = 300

export async function buildPack(input: {
  server: PackServer
  lock: Lock
  extras: ClientItem[]
  modrinth: ModrinthPack
}): Promise<BuiltPack> {
  const { server, lock, extras, modrinth } = input
  const reason = packUnavailable(server)
  if (reason) throw new Error(reason)

  const files: MrpackFile[] = []
  const summary: PackSummary = { included: [], skipped: [] }
  /** Project ids already in the pack, so dependencies aren't added twice. */
  const have = new Set<string>()
  const titles = new Map<string, string>()

  const add = (
    f: PackFile,
    kind: ClientKind,
    env: MrpackFile['env'],
    title: string,
    from: 'server' | 'extra',
  ) => {
    if (have.has(f.projectId) || files.length >= MAX_FILES) return
    have.add(f.projectId)
    files.push({
      path: `${CLIENT_KINDS[kind].folder}/${f.filename}`,
      hashes: { sha1: f.sha1, sha512: f.sha512 },
      env,
      downloads: [f.url],
      fileSize: f.size,
    })
    summary.included.push({ title, kind, version: f.versionNumber, from })
  }

  // From the server: Modrinth mods that players need too.
  const serverMods = lock.content.filter((i) => i.kind === 'mod')
  for (const i of serverMods.filter((i) => i.source !== 'modrinth')) {
    summary.skipped.push({ title: i.title, reason: "Not from Modrinth, so it can't be listed." })
  }
  const fromModrinth = serverMods.filter((i) => i.source === 'modrinth')
  const projects = new Map(
    (await modrinth.projects(fromModrinth.map((i) => i.projectId))).map((p) => [p.id, p]),
  )
  const versions = new Map(
    (await modrinth.files(fromModrinth.map((i) => i.versionId))).map((f) => [f.versionId, f]),
  )
  for (const i of fromModrinth) {
    const p = projects.get(i.projectId)
    titles.set(i.projectId, i.title)
    if (p?.clientSide === 'unsupported') {
      summary.skipped.push({ title: i.title, reason: 'Only runs on the server.' })
      continue
    }
    const f = versions.get(i.versionId)
    if (!f) {
      summary.skipped.push({ title: i.title, reason: "Modrinth didn't give its download." })
      continue
    }
    add(
      f,
      'mod',
      {
        client: p?.clientSide === 'optional' ? 'optional' : 'required',
        server: 'required',
      },
      i.title,
      'server',
    )
  }

  // Client extras, then their required dependencies.
  const extraProjects = new Map(
    (await modrinth.projects(extras.map((e) => e.modrinth))).flatMap((p) => [
      [p.id, p],
      [p.slug, p],
    ]),
  )
  const queue: { id: string; version?: string; depth: number; neededBy?: string }[] = extras.map(
    (e) => ({ id: e.modrinth, version: e.version, depth: 0 }),
  )
  while (queue.length) {
    const next = queue.shift()!
    let p = extraProjects.get(next.id)
    if (!p && next.depth > 0) {
      ;[p] = await modrinth.projects([next.id])
      if (p) extraProjects.set(p.id, p)
    }
    if (!p) {
      summary.skipped.push({ title: next.id, reason: 'Modrinth has no project by that name.' })
      continue
    }
    if (have.has(p.id)) continue
    const kind = clientKind(p.projectType)
    if (!kind) {
      summary.skipped.push({
        title: p.title,
        reason: `It's a ${p.projectType}, which can't go in a players' pack.`,
      })
      continue
    }
    const f = await modrinth.latest(p.id, {
      loaders: CLIENT_KINDS[kind].loaders(server.loader),
      minecraft: server.mcVersion,
      version: next.version,
    })
    if (!f) {
      summary.skipped.push({
        title: p.title,
        reason: next.version
          ? `No version "${next.version}" for Minecraft ${server.mcVersion}.`
          : `No version for Minecraft ${server.mcVersion} yet.`,
      })
      continue
    }
    add(
      f,
      kind,
      { client: 'required', server: 'unsupported' },
      next.neededBy ? `${p.title} (needed by ${next.neededBy})` : p.title,
      'extra',
    )
    if (kind === 'mod' && next.depth < MAX_DEPTH) {
      for (const d of f.dependencies) {
        if (!have.has(d.projectId)) {
          queue.push({
            id: d.projectId,
            version: d.versionId ?? undefined,
            depth: next.depth + 1,
            neededBy: p.title,
          })
        }
      }
    }
  }

  const index: MrpackIndex = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: lock.updatedAt,
    name: server.displayName,
    summary: `Everything you need to join ${server.displayName}.`,
    files,
    dependencies: { minecraft: server.mcVersion, 'fabric-loader': server.loaderVersion! },
  }
  return { index, ...summary }
}

function clientKind(projectType: string): ClientKind | null {
  if (projectType === 'mod') return 'mod'
  if (projectType === 'shader') return 'shader'
  if (projectType === 'resourcepack') return 'resourcepack'
  return null
}

/** A key that changes whenever the pack would: content, extras, versions or name. */
export function packKey(server: PackServer, lock: Lock, extras: ClientItem[]): string {
  const h = new Bun.CryptoHasher('sha256')
  h.update(
    JSON.stringify([
      server.displayName,
      server.mcVersion,
      server.loaderVersion,
      lock.updatedAt,
      lock.content.map((i) => i.versionId),
      extras,
    ]),
  )
  return h.digest('hex').slice(0, 16)
}

/** A safe file name for the download, like "NNT Survival.mrpack". */
export function packFilename(displayName: string): string {
  const base = displayName.replace(/[^\p{L}\p{N} ._-]+/gu, '').trim() || 'modpack'
  return `${base.slice(0, 60)}.mrpack`
}
