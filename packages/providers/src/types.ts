export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface VersionEntry {
  id: string
  stable: boolean
}

export type HashAlgorithm = 'sha1' | 'sha256'

export interface ExpectedHash {
  algorithm: HashAlgorithm
  value: string
}

/** Exactly what to download for a server, and the Java it needs. */
export interface ResolvedServer {
  url: string
  /** Null when the source publishes none (Fabric); the lockfile pins it on first download. */
  hash: ExpectedHash | null
  javaMajor: number
  loaderVersion: string | null
}

export type LoaderId = 'vanilla' | 'fabric'

export interface LoaderProvider {
  id: LoaderId
  name: string
  /** Minecraft versions this loader supports, newest first. */
  minecraftVersions(opts?: { includeSnapshots?: boolean }): Promise<VersionEntry[]>
  /** Loader versions for one Minecraft version, newest first (empty for vanilla). */
  loaderVersions(mc: string): Promise<VersionEntry[]>
  /** `loader` may be a version or 'latest-stable' (the default). */
  resolve(mc: string, loader?: string): Promise<ResolvedServer>
}

export class ProviderError extends Error {
  override name = 'ProviderError'
}
