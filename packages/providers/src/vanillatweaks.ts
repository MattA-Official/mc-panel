/**
 * Vanilla Tweaks (https://vanillatweaks.net). There is no official API, so this uses the
 * same JSON catalogue and pack builder the site's own pages use. Best-effort by design:
 * anything unexpected becomes a readable error that suggests uploading the pack instead.
 */
import { cached, USER_AGENT } from './http.ts'
import type { ResolvedContent } from './content.ts'
import { ProviderError, type Fetch } from './types.ts'

const SITE = 'https://vanillatweaks.net'

export type TweakType = 'datapack' | 'crafting'

export interface VtPack {
  /** Vanilla Tweaks' own id, lower case with spaces, like "multiplayer sleep". */
  name: string
  display: string
  description: string
  version: string
  /** Other pack names in the same catalogue this one can't run with. */
  incompatible: string[]
}

export interface VtCategory {
  name: string
  packs: VtPack[]
}

export interface VtCatalogue {
  /** The version string Vanilla Tweaks uses for this Minecraft version. */
  version: string
  datapacks: VtCategory[]
  crafting: VtCategory[]
}

export interface VtRef {
  /** "Category/pack name", e.g. "Survival/multiplayer sleep". */
  pack: string
  tweak?: TweakType
  /** A version to keep, from the lockfile. */
  version?: string
}

const FAIL =
  "Vanilla Tweaks didn't answer as expected. Try again later, or download the pack from vanillatweaks.net and upload it in Files."

interface RawPack {
  name?: unknown
  display?: unknown
  description?: unknown
  version?: unknown
  incompatible?: unknown
}
interface RawCategory {
  category?: unknown
  packs?: RawPack[]
  categories?: RawCategory[]
}

/** Flattens the site's nested categories into "Parent/Child" names. */
export function parseCategories(raw: unknown): VtCategory[] {
  const root = (raw as { categories?: RawCategory[] } | null)?.categories
  if (!Array.isArray(root)) throw new ProviderError(FAIL)
  const out: VtCategory[] = []
  const walk = (cats: RawCategory[], prefix: string) => {
    for (const c of cats) {
      if (typeof c.category !== 'string') continue
      const name = prefix ? `${prefix}/${c.category}` : c.category
      const packs = (Array.isArray(c.packs) ? c.packs : [])
        .filter((p) => typeof p.name === 'string')
        .map((p): VtPack => ({
          name: p.name as string,
          display: typeof p.display === 'string' ? p.display : (p.name as string),
          description:
            typeof p.description === 'string' ? p.description.replace(/<[^>]*>/g, '') : '',
          version: typeof p.version === 'string' ? p.version : '0',
          incompatible: Array.isArray(p.incompatible)
            ? p.incompatible.filter((x): x is string => typeof x === 'string')
            : [],
        }))
      if (packs.length) out.push({ name, packs })
      if (Array.isArray(c.categories)) walk(c.categories, name)
    }
  }
  walk(root, '')
  return out
}

/** The version strings to try for a Minecraft version: exact, then major.minor. */
export function vtVersions(mc: string): string[] {
  const parts = mc.split('.')
  return [...new Set([mc, parts.slice(0, 2).join('.')])]
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export function vanillaTweaksProvider(fetchImpl: Fetch = globalThis.fetch, site: string = SITE) {
  const cache = cached<VtCatalogue>(60 * 60_000)

  async function getJson(path: string): Promise<unknown | null> {
    let res: Response
    try {
      res = await fetchImpl(`${site}${path}`, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      })
    } catch {
      throw new ProviderError(
        "Couldn't reach Vanilla Tweaks. Check the server's internet connection, or upload the pack in Files.",
      )
    }
    if (res.status === 404) return null
    if (!res.ok) throw new ProviderError(FAIL)
    try {
      return await res.json()
    } catch {
      throw new ProviderError(FAIL)
    }
  }

  function catalogue(mc: string): Promise<VtCatalogue> {
    return cache(mc, async () => {
      for (const version of vtVersions(mc)) {
        const dp = await getJson(`/assets/resources/json/${version}/dpcategories.json`)
        if (!dp) continue
        const ct = await getJson(`/assets/resources/json/${version}/ctcategories.json`)
        return {
          version,
          datapacks: parseCategories(dp),
          crafting: ct ? parseCategories(ct) : [],
        }
      }
      throw new ProviderError(`Vanilla Tweaks has no packs for Minecraft ${mc} yet.`)
    })
  }

  async function resolve(ref: VtRef, mc: string): Promise<ResolvedContent> {
    const tweak = ref.tweak ?? 'datapack'
    const cat = await catalogue(mc)
    const at = ref.pack.lastIndexOf('/')
    const category = at > 0 ? ref.pack.slice(0, at) : ''
    const name = ref.pack.slice(at + 1).toLowerCase()
    const list = tweak === 'crafting' ? cat.crafting : cat.datapacks
    const group = list.find((c) => c.name.toLowerCase() === category.toLowerCase())
    const pack = group?.packs.find((p) => p.name.toLowerCase() === name)
    if (!group || !pack) {
      throw new ProviderError(
        `Vanilla Tweaks has no ${tweak === 'crafting' ? 'crafting tweak' : 'datapack'} "${ref.pack}" for Minecraft ${mc}.`,
      )
    }
    // The builder keys packs by their top-level category, lower case.
    const top = group.name.split('/')[0]!.toLowerCase()
    const packs = JSON.stringify({ [top]: [pack.name] })
    const version = ref.version ?? pack.version
    const id = `${tweak}:${group.name}/${pack.name}`
    return {
      source: 'vanillatweaks',
      projectId: id,
      slug: `${group.name}/${pack.name}`,
      title: pack.display,
      versionId: version,
      versionNumber: version,
      kind: 'datapack',
      filename: `vt-${tweak === 'crafting' ? 'ct-' : ''}${slug(pack.name)}.zip`,
      url: `${site}/${tweak === 'crafting' ? 'crafting-tweaks' : 'datapacks'}/`,
      hash: null,
      size: null,
      dependencies: [],
      incompatible: pack.incompatible.flatMap((n) => {
        const home = list.find((c) => c.packs.some((p) => p.name === n))
        return home ? [`${tweak}:${home.name}/${n}`] : []
      }),
      request: {
        url: `${site}/assets/server/${tweak === 'crafting' ? 'zipcraftingtweaks' : 'zipdatapacks'}.php`,
        form: { packs, version: cat.version },
      },
      wrapped: tweak === 'datapack',
    }
  }

  return { id: 'vanillatweaks' as const, name: 'Vanilla Tweaks', catalogue, resolve }
}

export type VanillaTweaksProvider = ReturnType<typeof vanillaTweaksProvider>

/**
 * For a built-on-request download: POSTs the form and returns the absolute link to fetch.
 */
export async function requestDownload(
  fetchImpl: Fetch,
  request: NonNullable<ResolvedContent['request']>,
): Promise<string> {
  let res: Response
  try {
    res = await fetchImpl(request.url, {
      method: 'POST',
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      body: new URLSearchParams(request.form),
      signal: AbortSignal.timeout(60_000),
    })
  } catch {
    throw new ProviderError("Couldn't reach Vanilla Tweaks to build the pack. Try again later.")
  }
  const body = (await res.json().catch(() => null)) as { status?: string; link?: string } | null
  if (!res.ok || body?.status !== 'success' || typeof body.link !== 'string') {
    throw new ProviderError(FAIL)
  }
  // Only ever follow a link back to the same site.
  const link = new URL(body.link, request.url)
  if (link.origin !== new URL(request.url).origin) throw new ProviderError(FAIL)
  return link.href
}
