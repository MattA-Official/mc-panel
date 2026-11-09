/**
 * Hangar (https://hangar.papermc.io), PaperMC's plugin repository, API v1. Reading needs
 * no key. Downloads hosted on Hangar come with a sha256, which is checked; versions that
 * only link to another site have no hash and are refused.
 */
import { cached, USER_AGENT } from './http.ts'
import type {
  ContentHit,
  ContentProvider,
  ContentRef,
  ContentTarget,
  ContentVersion,
  ResolvedContent,
} from './content.ts'
import { ProviderError, type Fetch } from './types.ts'

const API = 'https://hangar.papermc.io/api/v1'
const PLATFORM = 'PAPER'

interface Project {
  id: number
  name: string
  namespace: { owner: string; slug: string }
  description?: string
  avatarUrl?: string
  stats?: { downloads?: number }
}
interface Download {
  fileInfo?: { name?: string; sizeBytes?: number; sha256Hash?: string } | null
  externalUrl?: string | null
  downloadUrl?: string | null
}
interface Dependency {
  name: string
  required: boolean
  externalUrl?: string | null
}
interface Version {
  id: number
  name: string
  createdAt: string
  channel?: { name?: string }
  downloads?: Record<string, Download>
  pluginDependencies?: Record<string, Dependency[]>
  platformDependencies?: Record<string, string[]>
}
interface Page<T> {
  pagination?: { count?: number }
  result?: T[]
}

const SLUG = /^[\w.-]{1,64}$/

/** Hangar's channel names are free text; these are the usual ones. */
function channelOf(v: Version): ContentVersion['channel'] {
  const name = (v.channel?.name ?? '').toLowerCase()
  if (name.includes('alpha') || name.includes('snapshot') || name.includes('dev')) return 'alpha'
  if (name.includes('beta') || name.includes('pre')) return 'beta'
  return 'release'
}
const RANK = { release: 0, beta: 1, alpha: 2 } as const

/** Accepts "slug" or "owner/slug"; Hangar slugs are unique on their own. */
const slugOf = (ref: string) => ref.slice(ref.lastIndexOf('/') + 1)

export function hangarProvider(
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
        throw new ProviderError("Couldn't reach Hangar. Check the server's internet connection.")
      }
      if (res.status === 404) return null
      if (res.status === 429) throw new ProviderError('Hangar is busy. Try again in a minute.')
      if (!res.ok) throw new ProviderError(`Hangar answered ${res.status}. Try again in a minute.`)
      return res.json()
    }) as Promise<T | null>
  }

  async function project(ref: string): Promise<Project> {
    const slug = slugOf(ref)
    if (!SLUG.test(slug)) throw new ProviderError(`"${ref}" isn't a Hangar project.`)
    const p = await get<Project>(`/projects/${encodeURIComponent(slug)}`)
    if (!p) throw new ProviderError(`Hangar has no project called "${ref}".`)
    return p
  }

  /** Versions that run on Paper for this Minecraft version, best first. */
  async function compatible(p: Project, target: ContentTarget): Promise<Version[]> {
    const q = new URLSearchParams({
      limit: '25',
      offset: '0',
      platform: PLATFORM,
      platformVersion: target.minecraft,
    })
    const page = await get<Page<Version>>(
      `/projects/${encodeURIComponent(p.namespace.slug)}/versions?${q}`,
    )
    return (page?.result ?? [])
      .filter((v) => (v.platformDependencies?.[PLATFORM] ?? []).includes(target.minecraft))
      .sort(
        (a, b) => RANK[channelOf(a)] - RANK[channelOf(b)] || b.createdAt.localeCompare(a.createdAt),
      )
  }

  function toResolved(p: Project, v: Version): ResolvedContent {
    const d = v.downloads?.[PLATFORM]
    const sha256 = d?.fileInfo?.sha256Hash ?? ''
    if (!d?.downloadUrl || !/^[0-9a-f]{64}$/i.test(sha256)) {
      throw new ProviderError(
        d?.externalUrl
          ? `${p.name} ${v.name} is hosted outside Hangar, so it can't be checked. Add it as a url item with its sha256 instead.`
          : `${p.name} ${v.name} has no Paper download on Hangar.`,
      )
    }
    const name =
      d.fileInfo?.name && /^[\w.+ -]{1,120}\.jar$/i.test(d.fileInfo.name)
        ? d.fileInfo.name.replace(/ /g, '-')
        : `${p.namespace.slug}-${v.name}.jar`.replace(/[^\w.+-]/g, '-')
    return {
      source: 'hangar',
      projectId: `hangar:${p.namespace.slug}`,
      slug: p.namespace.slug,
      title: p.name,
      versionId: v.name,
      versionNumber: v.name,
      kind: 'plugin',
      filename: name,
      url: new URL(d.downloadUrl, api).href,
      hash: { algorithm: 'sha256', value: sha256.toLowerCase() },
      size: d.fileInfo?.sizeBytes ?? null,
      // Dependencies hosted elsewhere can't be resolved here; they're left to the person.
      dependencies: (v.pluginDependencies?.[PLATFORM] ?? [])
        .filter((dep) => dep.required && !dep.externalUrl && SLUG.test(dep.name))
        .map((dep) => ({ projectId: `hangar:${dep.name}`, versionId: null })),
      incompatible: [],
    }
  }

  return {
    id: 'hangar',
    name: 'Hangar',

    async search(query, { target, limit = 20, offset = 0 }) {
      const q = new URLSearchParams({
        q: query.slice(0, 100),
        limit: String(Math.min(Math.max(limit, 1), 25)),
        offset: String(Math.max(offset, 0)),
        platform: PLATFORM,
        version: target.minecraft,
        sort: query ? '-stars' : '-downloads',
      })
      const page = await get<Page<Project>>(`/projects?${q}`)
      return {
        hits: (page?.result ?? []).map((p): ContentHit => ({
          source: 'hangar',
          projectId: `hangar:${p.namespace.slug}`,
          slug: p.namespace.slug,
          title: p.name,
          description: p.description ?? '',
          author: p.namespace.owner,
          iconUrl: p.avatarUrl || null,
          downloads: p.stats?.downloads ?? 0,
          kind: 'plugin',
          serverSide: 'required',
        })),
        total: page?.pagination?.count ?? 0,
      }
    },

    async versions(ref, { target }): Promise<ContentVersion[]> {
      const p = await project(ref)
      return (await compatible(p, target)).map((v) => ({
        versionId: v.name,
        versionNumber: v.name,
        channel: channelOf(v),
        published: v.createdAt,
        minecraft: v.platformDependencies?.[PLATFORM] ?? [],
      }))
    },

    async resolve(ref: ContentRef, target: ContentTarget): Promise<ResolvedContent> {
      if (ref.kind && ref.kind !== 'plugin') {
        throw new ProviderError(`Hangar only has plugins, not ${ref.kind}s.`)
      }
      const p = await project(ref.project.replace(/^hangar:/, ''))
      if (ref.version) {
        const v = await get<Version>(
          `/projects/${encodeURIComponent(p.namespace.slug)}/versions/${encodeURIComponent(ref.version)}`,
        )
        if (!v) throw new ProviderError(`${p.name} has no version "${ref.version}".`)
        if (!(v.platformDependencies?.[PLATFORM] ?? []).includes(target.minecraft)) {
          throw new ProviderError(
            `${p.name} ${v.name} isn't made for Paper on Minecraft ${target.minecraft}.`,
          )
        }
        return toResolved(p, v)
      }
      const [v] = await compatible(p, target)
      if (!v) {
        throw new ProviderError(
          `${p.name} has no version for Paper on Minecraft ${target.minecraft}.`,
        )
      }
      return toResolved(p, v)
    },
  }
}
