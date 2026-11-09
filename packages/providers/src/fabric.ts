import { cached, getJson } from './http.ts'
import type { Mojang } from './mojang.ts'
import {
  ProviderError,
  type Fetch,
  type LoaderProvider,
  type ResolvedServer,
  type VersionEntry,
} from './types.ts'

const META = 'https://meta.fabricmc.net/v2'

interface GameVersion {
  version: string
  stable: boolean
}
interface LoaderEntry {
  loader: { version: string; stable: boolean }
}
interface InstallerVersion {
  version: string
  stable: boolean
}

export function fabricProvider(fetchImpl: Fetch, mojang: Mojang): LoaderProvider {
  const cache = cached<unknown>(10 * 60_000)
  const get = <T>(path: string) =>
    cache(path, () => getJson<T>(fetchImpl, `${META}${path}`, 'Fabric')) as Promise<T>

  async function loaderVersions(mc: string): Promise<VersionEntry[]> {
    const entries = await get<LoaderEntry[]>(`/versions/loader/${encodeURIComponent(mc)}`)
    return entries.map((e) => ({ id: e.loader.version, stable: e.loader.stable }))
  }

  return {
    id: 'fabric',
    name: 'Fabric',
    async minecraftVersions({ includeSnapshots = false } = {}) {
      const games = await get<GameVersion[]>('/versions/game')
      return games
        .filter((g) => includeSnapshots || g.stable)
        .map((g) => ({ id: g.version, stable: g.stable }))
    },
    loaderVersions,
    async resolve(mc: string, loader = 'latest-stable'): Promise<ResolvedServer> {
      const loaders = await loaderVersions(mc)
      if (loaders.length === 0)
        throw new ProviderError(`Fabric doesn't support Minecraft ${mc} yet.`)
      const chosen =
        loader === 'latest-stable'
          ? (loaders.find((l) => l.stable) ?? loaders[0])
          : loaders.find((l) => l.id === loader)
      if (!chosen)
        throw new ProviderError(`Fabric loader ${loader} doesn't support Minecraft ${mc}.`)

      const installers = await get<InstallerVersion[]>('/versions/installer')
      const installer = installers.find((i) => i.stable) ?? installers[0]
      if (!installer) throw new ProviderError('Fabric lists no installer versions.')

      const path = [mc, chosen.id, installer.version].map(encodeURIComponent).join('/')
      return {
        url: `${META}/versions/loader/${path}/server/jar`,
        hash: null,
        javaMajor: await mojang.javaMajor(mc),
        loaderVersion: chosen.id,
      }
    },
  }
}
