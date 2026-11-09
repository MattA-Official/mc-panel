/**
 * Content providers: mods and datapacks from somewhere, resolved to one exact file with a
 * hash. The panel sees only this interface.
 */
import type { ExpectedHash, LoaderId } from './types.ts'

export type ContentKind = 'mod' | 'datapack'
export type ContentSourceId = 'modrinth' | 'url'

/** The server content is for. */
export interface ContentTarget {
  loader: LoaderId
  minecraft: string
}

/** Which loaders accept which kinds. Every loader takes datapacks. */
export const ACCEPTS: Record<LoaderId, readonly ContentKind[]> = {
  vanilla: ['datapack'],
  fabric: ['mod', 'datapack'],
}

export interface ContentHit {
  source: ContentSourceId
  projectId: string
  slug: string
  title: string
  description: string
  author: string
  iconUrl: string | null
  downloads: number
  kind: ContentKind
  /** Whether the server needs it; client-only items never appear. */
  serverSide: 'required' | 'optional' | 'unknown'
}

export interface ContentVersion {
  versionId: string
  versionNumber: string
  channel: 'release' | 'beta' | 'alpha'
  published: string
  minecraft: string[]
}

export interface ResolvedContent {
  source: ContentSourceId
  projectId: string
  slug: string
  title: string
  versionId: string
  versionNumber: string
  kind: ContentKind
  filename: string
  url: string
  hash: ExpectedHash
  size: number | null
  /** Required dependencies, as project ids with an exact version when the author pinned one. */
  dependencies: { projectId: string; versionId: string | null }[]
  /** Projects this one says it can't run with. */
  incompatible: string[]
}

export interface ContentRef {
  project: string
  version?: string
  kind?: ContentKind
}

export interface ContentProvider {
  id: ContentSourceId
  name: string
  search(
    query: string,
    opts: { kind: ContentKind; target: ContentTarget; limit?: number; offset?: number },
  ): Promise<{ hits: ContentHit[]; total: number }>
  versions(
    project: string,
    opts: { kind: ContentKind; target: ContentTarget },
  ): Promise<ContentVersion[]>
  resolve(ref: ContentRef, target: ContentTarget): Promise<ResolvedContent>
}
