/**
 * Paper (https://papermc.io), through PaperMC's Fill API v3. Builds come with a sha256,
 * which the download checks. PaperMC asks API users to send a descriptive User-Agent.
 */
import { cached, getJson } from './http.ts'
import type { Mojang } from './mojang.ts'
import {
  ProviderError,
  type Fetch,
  type LoaderProvider,
  type ResolvedServer,
  type VersionEntry,
} from './types.ts'

const FILL = 'https://fill.papermc.io/v3/projects/paper'

interface Project {
  versions?: Record<string, string[]>
}
interface Build {
  id: number
  channel?: string
  downloads?: Record<string, { url?: string; checksums?: { sha256?: string } }>
}
interface VersionInfo {
  version?: { java?: { version?: { minimum?: number } } }
}

/** "1.21.4" before "1.21.4-rc1" before "1.21.3", and 26.x after 1.x. */
function compareMc(a: string, b: string): number {
  const split = (v: string) => {
    const [main = '', pre] = v.split('-')
    return { nums: main.split('.').map((n) => Number(n) || 0), pre: pre ?? null }
  }
  const x = split(a)
  const y = split(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return d
  }
  if (x.pre === y.pre) return 0
  if (x.pre === null) return 1
  if (y.pre === null) return -1
  return x.pre.localeCompare(y.pre, 'en', { numeric: true })
}

const hasDownload = (b: Build) =>
  /^[0-9a-f]{64}$/i.test(b.downloads?.['server:default']?.checksums?.sha256 ?? '') &&
  !!b.downloads?.['server:default']?.url

export function paperProvider(fetchImpl: Fetch, mojang: Mojang, base = FILL): LoaderProvider {
  const cache = cached<unknown>(10 * 60_000)
  const get = <T>(path: string) =>
    cache(path, () => getJson<T>(fetchImpl, `${base}${path}`, 'PaperMC')) as Promise<T>

  async function builds(mc: string): Promise<Build[]> {
    let list: Build[]
    try {
      list = await get<Build[]>(`/versions/${encodeURIComponent(mc)}/builds`)
    } catch (err) {
      if (err instanceof ProviderError && /doesn't know/.test(err.message)) return []
      throw err
    }
    if (!Array.isArray(list)) throw new ProviderError('PaperMC answered in an unexpected way.')
    return [...list].filter((b) => typeof b.id === 'number').sort((a, b) => b.id - a.id)
  }

  return {
    id: 'paper',
    name: 'Paper',
    async minecraftVersions({ includeSnapshots = false } = {}) {
      const project = await get<Project>('')
      const all = Object.values(project.versions ?? {}).flat()
      return [...new Set(all)]
        .sort((a, b) => compareMc(b, a))
        .map((id): VersionEntry => ({ id, stable: !id.includes('-') }))
        .filter((v) => includeSnapshots || v.stable)
    },
    async loaderVersions(mc) {
      return (await builds(mc)).map((b) => ({ id: String(b.id), stable: b.channel === 'STABLE' }))
    },
    async resolve(mc, build = 'latest-stable'): Promise<ResolvedServer> {
      const list = await builds(mc)
      if (list.length === 0) throw new ProviderError(`Paper doesn't support Minecraft ${mc} yet.`)
      const usable = list.filter(hasDownload)
      const chosen =
        build === 'latest-stable'
          ? (usable.find((b) => b.channel === 'STABLE') ?? usable[0])
          : list.find((b) => String(b.id) === build)
      if (!chosen && build === 'latest-stable') {
        throw new ProviderError(`PaperMC lists no downloadable build for Minecraft ${mc}.`)
      }
      if (!chosen) throw new ProviderError(`Paper has no build ${build} for Minecraft ${mc}.`)
      const download = chosen.downloads?.['server:default']
      const sha256 = download?.checksums?.sha256
      if (!download?.url || !sha256 || !/^[0-9a-f]{64}$/i.test(sha256)) {
        throw new ProviderError(`PaperMC lists no download for build ${chosen.id}.`)
      }
      const info = await get<VersionInfo>(`/versions/${encodeURIComponent(mc)}`).catch(() => null)
      const paperJava = info?.version?.java?.version?.minimum ?? 0
      const mojangJava = await mojang.javaMajor(mc).catch(() => 0)
      const javaMajor = Math.max(paperJava, mojangJava)
      if (!javaMajor) throw new ProviderError(`Couldn't tell which Java Minecraft ${mc} needs.`)
      return {
        url: download.url,
        hash: { algorithm: 'sha256', value: sha256.toLowerCase() },
        javaMajor,
        loaderVersion: String(chosen.id),
      }
    },
  }
}
