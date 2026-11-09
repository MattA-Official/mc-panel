/** Modrinth (https://docs.modrinth.com/api/), API v2. No key is needed for reading. */
import { cached, USER_AGENT } from './http.ts'
import type {
  ContentHit,
  ContentKind,
  ContentProvider,
  ContentRef,
  ContentTarget,
  ContentVersion,
  ResolvedContent,
} from './content.ts'
import { ProviderError, type Fetch } from './types.ts'

const API = 'https://api.modrinth.com/v2'

interface SearchResponse {
  hits: {
    project_id: string
    slug: string
    title: string
    description: string
    author: string
    icon_url: string | null
    downloads: number
    project_type: string
    server_side: string
  }[]
  total_hits: number
}

interface Project {
  id: string
  slug: string
  title: string
  project_type: string
  server_side: string
  loaders: string[]
}

interface Version {
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
    dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded'
  }[]
}

const CHANNEL_RANK = { release: 0, beta: 1, alpha: 2 } as const

/** Loaders to ask Modrinth for. Datapacks are their own "loader" there. */
const loadersFor = (kind: ContentKind, target: ContentTarget) =>
  kind === 'datapack' ? ['datapack'] : [target.loader]

/** Newest release first, then betas, then alphas. */
export function rankVersions<T extends { version_type: string; date_published: string }>(
  list: T[],
): T[] {
  return [...list].sort(
    (a, b) =>
      CHANNEL_RANK[a.version_type as keyof typeof CHANNEL_RANK] -
        CHANNEL_RANK[b.version_type as keyof typeof CHANNEL_RANK] ||
      b.date_published.localeCompare(a.date_published),
  )
}

export function modrinthProvider(
  fetchImpl: Fetch = globalThis.fetch,
  api: string = API,
): ContentProvider {
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

  async function project(idOrSlug: string): Promise<Project> {
    if (!/^[\w.-]{1,64}$/.test(idOrSlug))
      throw new ProviderError(`"${idOrSlug}" isn't a Modrinth project.`)
    const p = await get<Project>(`/project/${encodeURIComponent(idOrSlug)}`)
    if (!p) throw new ProviderError(`Modrinth has no project called "${idOrSlug}".`)
    return p
  }

  function kindOf(p: Project, wanted?: ContentKind): ContentKind {
    const can: ContentKind[] = []
    if (p.project_type === 'mod' && p.loaders.some((l) => l !== 'datapack')) can.push('mod')
    if (p.project_type === 'datapack' || p.loaders.includes('datapack')) can.push('datapack')
    if (wanted) {
      if (!can.includes(wanted)) {
        throw new ProviderError(`${p.title} isn't available as a ${wanted} on Modrinth.`)
      }
      return wanted
    }
    if (!can.length) {
      throw new ProviderError(
        `${p.title} is a ${p.project_type}, which Flytower can't install yet.`,
      )
    }
    return can[0]!
  }

  async function compatible(p: Project, kind: ContentKind, target: ContentTarget) {
    const q = new URLSearchParams({
      loaders: JSON.stringify(loadersFor(kind, target)),
      game_versions: JSON.stringify([target.minecraft]),
    })
    return rankVersions((await get<Version[]>(`/project/${p.id}/version?${q}`)) ?? [])
  }

  function toResolved(p: Project, v: Version, kind: ContentKind): ResolvedContent {
    const file = v.files.find((f) => f.primary) ?? v.files[0]
    if (!file) throw new ProviderError(`${p.title} ${v.version_number} has no file to download.`)
    if (!file.hashes.sha512) {
      throw new ProviderError(`Modrinth publishes no checksum for ${p.title} ${v.version_number}.`)
    }
    if (!/^[\w.+-]{1,160}$/.test(file.filename)) {
      throw new ProviderError(`${p.title} has an unusual file name, so it was not installed.`)
    }
    return {
      source: 'modrinth',
      projectId: p.id,
      slug: p.slug,
      title: p.title,
      versionId: v.id,
      versionNumber: v.version_number,
      kind,
      filename: file.filename,
      url: file.url,
      hash: { algorithm: 'sha512', value: file.hashes.sha512 },
      size: file.size,
      dependencies: v.dependencies
        .filter((d) => d.dependency_type === 'required' && d.project_id)
        .map((d) => ({ projectId: d.project_id!, versionId: d.version_id })),
      incompatible: v.dependencies
        .filter((d) => d.dependency_type === 'incompatible' && d.project_id)
        .map((d) => d.project_id!),
    }
  }

  return {
    id: 'modrinth',
    name: 'Modrinth',

    async search(query, { kind, target, limit = 20, offset = 0 }) {
      const facets: string[][] = [
        [`project_type:${kind}`],
        [`versions:${target.minecraft}`],
        ...(kind === 'mod' ? [[`categories:${target.loader}`]] : []),
        // Client-only mods do nothing on a server.
        ...(kind === 'mod' ? [['server_side:required', 'server_side:optional']] : []),
      ]
      const q = new URLSearchParams({
        query: query.slice(0, 100),
        facets: JSON.stringify(facets),
        limit: String(Math.min(Math.max(limit, 1), 50)),
        offset: String(Math.max(offset, 0)),
        index: query ? 'relevance' : 'downloads',
      })
      const res = await get<SearchResponse>(`/search?${q}`)
      const hits = (res?.hits ?? [])
        .filter((h) => h.server_side !== 'unsupported')
        .map((h): ContentHit => ({
          source: 'modrinth',
          projectId: h.project_id,
          slug: h.slug,
          title: h.title,
          description: h.description,
          author: h.author,
          iconUrl: h.icon_url || null,
          downloads: h.downloads,
          kind,
          serverSide:
            h.server_side === 'required' || h.server_side === 'optional'
              ? h.server_side
              : 'unknown',
        }))
      return { hits, total: res?.total_hits ?? 0 }
    },

    async versions(idOrSlug, { kind, target }): Promise<ContentVersion[]> {
      const p = await project(idOrSlug)
      return (await compatible(p, kindOf(p, kind), target)).map((v) => ({
        versionId: v.id,
        versionNumber: v.version_number,
        channel: v.version_type,
        published: v.date_published,
        minecraft: v.game_versions,
      }))
    },

    async resolve(ref: ContentRef, target: ContentTarget): Promise<ResolvedContent> {
      const p = await project(ref.project)
      if (p.server_side === 'unsupported') {
        throw new ProviderError(`${p.title} only runs on players' computers, not on a server.`)
      }
      const kind = kindOf(p, ref.kind)
      if (ref.version) {
        // An exact version: by id, or by version number among this project's versions.
        const byId = /^[A-Za-z0-9]{8}$/.test(ref.version)
          ? await get<Version>(`/version/${ref.version}`)
          : null
        const v =
          byId && byId.project_id === p.id
            ? byId
            : ((await get<Version[]>(`/project/${p.id}/version`)) ?? []).find(
                (x) => x.version_number === ref.version,
              )
        if (!v) throw new ProviderError(`${p.title} has no version "${ref.version}".`)
        const loaders = loadersFor(kind, target)
        if (!v.loaders.some((l) => loaders.includes(l))) {
          throw new ProviderError(
            `${p.title} ${v.version_number} isn't made for ${loaders.join(' or ')}.`,
          )
        }
        if (!v.game_versions.includes(target.minecraft)) {
          throw new ProviderError(
            `${p.title} ${v.version_number} isn't made for Minecraft ${target.minecraft}.`,
          )
        }
        return toResolved(p, v, kind)
      }
      const [v] = await compatible(p, kind, target)
      if (!v) {
        throw new ProviderError(
          `${p.title} has no version for ${kind === 'mod' ? `${target.loader} on ` : ''}Minecraft ${target.minecraft}.`,
        )
      }
      return toResolved(p, v, kind)
    },
  }
}
