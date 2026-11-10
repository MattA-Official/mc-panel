import { cached, getJson } from './http.ts'
import {
  ProviderError,
  type ExpectedHash,
  type Fetch,
  type LoaderProvider,
  type ResolvedServer,
  type VersionEntry,
} from './types.ts'

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

interface Manifest {
  latest: { release: string; snapshot: string }
  versions: { id: string; type: string; url: string }[]
}

interface VersionJson {
  downloads?: { server?: { sha1: string; url: string }; client?: { sha1: string; url: string } }
  javaVersion?: { majorVersion: number }
}

/** Reads Mojang's own metadata. Fabric uses it too, for the Java version. */
export class Mojang {
  private cache = cached<unknown>(10 * 60_000)

  constructor(private fetchImpl: Fetch) {}

  manifest() {
    return this.cache('manifest', () =>
      getJson<Manifest>(this.fetchImpl, MANIFEST, 'Mojang'),
    ) as Promise<Manifest>
  }

  async versionJson(mc: string): Promise<VersionJson> {
    const entry = (await this.manifest()).versions.find((v) => v.id === mc)
    if (!entry) throw new ProviderError(`Minecraft ${mc} doesn't exist.`)
    return this.cache(`v:${mc}`, () =>
      getJson<VersionJson>(this.fetchImpl, entry.url, 'Mojang'),
    ) as Promise<VersionJson>
  }

  /**
   * The game client for a version. The web map reads its textures and biome data for
   * colours; nothing in it is ever run.
   */
  async clientJar(mc: string): Promise<{ url: string; hash: ExpectedHash }> {
    const client = (await this.versionJson(mc)).downloads?.client
    if (!client) throw new ProviderError(`Minecraft ${mc} has no client download.`)
    return { url: client.url, hash: { algorithm: 'sha1', value: client.sha1 } }
  }

  /**
   * The vanilla server for a version. The console's command completion runs its data
   * generator for the game's own list of commands.
   */
  async serverJar(mc: string): Promise<{ url: string; hash: ExpectedHash }> {
    const server = (await this.versionJson(mc)).downloads?.server
    if (!server) throw new ProviderError(`Minecraft ${mc} has no server download.`)
    return { url: server.url, hash: { algorithm: 'sha1', value: server.sha1 } }
  }

  async javaMajor(mc: string): Promise<number> {
    const major = (await this.versionJson(mc)).javaVersion?.majorVersion
    // Versions before 1.17 omit it; they all run on Java 8.
    return major ?? 8
  }
}

export function vanillaProvider(mojang: Mojang): LoaderProvider {
  return {
    id: 'vanilla',
    name: 'Vanilla',
    async minecraftVersions({ includeSnapshots = false } = {}): Promise<VersionEntry[]> {
      const m = await mojang.manifest()
      return m.versions
        .filter((v) => v.type === 'release' || (includeSnapshots && v.type === 'snapshot'))
        .map((v) => ({ id: v.id, stable: v.type === 'release' }))
    },
    async loaderVersions() {
      return []
    },
    async resolve(mc: string): Promise<ResolvedServer> {
      const v = await mojang.versionJson(mc)
      const server = v.downloads?.server
      if (!server) throw new ProviderError(`Minecraft ${mc} has no server download.`)
      return {
        url: server.url,
        hash: { algorithm: 'sha1', value: server.sha1 },
        javaMajor: v.javaVersion?.majorVersion ?? 8,
        loaderVersion: null,
      }
    },
  }
}
