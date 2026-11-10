/**
 * What a Modrinth modpack (`.mrpack`) needs to know about files: both hashes, the download,
 * and which side each project runs on. Used to build a players' pack for a server's public
 * page from its lockfile, plus client-only extras such as shader packs.
 *
 * See https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack.
 */
import { cached, USER_AGENT } from './http.ts'
import { rankVersions } from './modrinth.ts'
import { ProviderError, type Fetch } from './types.ts'

const API = 'https://api.modrinth.com/v2'

export type Side = 'required' | 'optional' | 'unsupported' | 'unknown'

export interface PackProject {
  id: string
  slug: string
  title: string
  projectType: string
  clientSide: Side
  serverSide: Side
}

export interface PackFile {
  projectId: string
  versionId: string
  versionNumber: string
  filename: string
  url: string
  size: number
  sha1: string
  sha512: string
  /** Required dependencies, as project ids with a version when the author pinned one. */
  dependencies: { projectId: string; versionId: string | null }[]
}

/** Where each kind of client extra goes in the player's instance, and what it's built for. */
export const CLIENT_KINDS = {
  mod: { folder: 'mods', loaders: (loader: string) => [loader] },
  shader: { folder: 'shaderpacks', loaders: () => ['iris', 'optifine'] },
  resourcepack: { folder: 'resourcepacks', loaders: () => ['minecraft'] },
} as const
export type ClientKind = keyof typeof CLIENT_KINDS

interface RawProject {
  id: string
  slug: string
  title: string
  project_type: string
  client_side: string
  server_side: string
}

interface RawVersion {
  id: string
  project_id: string
  version_number: string
  version_type: 'release' | 'beta' | 'alpha'
  loaders: string[]
  game_versions: string[]
  date_published: string
  files: {
    url: string
    filename: string
    primary: boolean
    size: number
    hashes: { sha512?: string; sha1?: string }
  }[]
  dependencies: {
    version_id: string | null
    project_id: string | null
    dependency_type: string
  }[]
}

const side = (s: string): Side =>
  s === 'required' || s === 'optional' || s === 'unsupported' ? s : 'unknown'

/** Modrinth only serves downloads from its CDN; anything else isn't allowed in a pack. */
const PACK_HOSTS = new Set(['cdn.modrinth.com'])

export function modrinthPack(fetchImpl: Fetch = globalThis.fetch, api: string = API) {
  const cache = cached<unknown>(10 * 60_000)

  async function get<T>(path: string): Promise<T | null> {
    return cache(path, async () => {
      let res: Response
      try {
        res = await fetchImpl(`${api}${path}`, {
          headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
          signal: AbortSignal.timeout(20_000),
        })
      } catch {
        throw new ProviderError("Couldn't reach Modrinth. Check the server's internet connection.")
      }
      if (res.status === 404) return null
      if (res.status === 429) throw new ProviderError('Modrinth is busy. Try again in a minute.')
      if (!res.ok)
        throw new ProviderError(`Modrinth answered ${res.status}. Try again in a minute.`)
      return res.json()
    }) as Promise<T | null>
  }

  function toFile(v: RawVersion): PackFile | null {
    const f = v.files.find((x) => x.primary) ?? v.files[0]
    if (!f?.hashes.sha1 || !f.hashes.sha512) return null
    let host: string
    try {
      host = new URL(f.url).hostname
    } catch {
      return null
    }
    if (!PACK_HOSTS.has(host) || !/^[\w.+-]{1,160}$/.test(f.filename)) return null
    return {
      projectId: v.project_id,
      versionId: v.id,
      versionNumber: v.version_number,
      filename: f.filename,
      url: f.url,
      size: f.size,
      sha1: f.hashes.sha1,
      sha512: f.hashes.sha512,
      dependencies: v.dependencies
        .filter((d) => d.dependency_type === 'required' && d.project_id)
        .map((d) => ({ projectId: d.project_id!, versionId: d.version_id })),
    }
  }

  return {
    /** Projects by id or slug, in one request. Unknown ones are left out. */
    async projects(ids: string[]): Promise<PackProject[]> {
      if (!ids.length) return []
      const q = new URLSearchParams({ ids: JSON.stringify([...new Set(ids)].sort()) })
      const raw = (await get<RawProject[]>(`/projects?${q}`)) ?? []
      return raw.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        projectType: p.project_type,
        clientSide: side(p.client_side),
        serverSide: side(p.server_side),
      }))
    },

    /** Exact versions by id, in one request. A version without a usable file is left out. */
    async files(versionIds: string[]): Promise<PackFile[]> {
      if (!versionIds.length) return []
      const q = new URLSearchParams({ ids: JSON.stringify([...new Set(versionIds)].sort()) })
      const raw = (await get<RawVersion[]>(`/versions?${q}`)) ?? []
      return raw.map(toFile).filter((f): f is PackFile => !!f)
    },

    /** The newest file of a project for this Minecraft version and these loaders. */
    async latest(
      projectId: string,
      opts: { loaders: readonly string[]; minecraft: string; version?: string },
    ): Promise<PackFile | null> {
      if (!/^[\w.-]{1,64}$/.test(projectId)) return null
      const q = new URLSearchParams({
        loaders: JSON.stringify(opts.loaders),
        game_versions: JSON.stringify([opts.minecraft]),
      })
      const all = rankVersions(
        (await get<RawVersion[]>(`/project/${encodeURIComponent(projectId)}/version?${q}`)) ?? [],
      )
      const picked = opts.version
        ? all.find((v) => v.id === opts.version || v.version_number === opts.version)
        : all[0]
      return picked ? toFile(picked) : null
    },
  }
}

export type ModrinthPack = ReturnType<typeof modrinthPack>
