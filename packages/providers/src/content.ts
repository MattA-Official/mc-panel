/**
 * Content providers: mods and datapacks from somewhere, resolved to one exact file with a
 * hash. The panel sees only this interface.
 */
import type { ExpectedHash, LoaderId } from './types.ts'

export type ContentKind = 'mod' | 'plugin' | 'datapack'
export const CONTENT_KINDS = ['mod', 'plugin', 'datapack'] as const satisfies readonly ContentKind[]
export type ContentSourceId = 'modrinth' | 'hangar' | 'url' | 'vanillatweaks'

/** The server content is for. */
export interface ContentTarget {
  loader: LoaderId
  minecraft: string
}

/** Which loaders accept which kinds. Every loader takes datapacks. */
export const ACCEPTS: Record<LoaderId, readonly ContentKind[]> = {
  vanilla: ['datapack'],
  fabric: ['mod', 'datapack'],
  paper: ['plugin', 'datapack'],
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
  /**
   * Whether the server needs it. Client-only items ('unsupported') appear only when the
   * search asks for them.
   */
  serverSide: 'required' | 'optional' | 'unsupported' | 'unknown'
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
  /** Null when the source publishes none; the lockfile then pins what was downloaded. */
  hash: ExpectedHash | null
  size: number | null
  /** Required dependencies, as project ids with an exact version when the author pinned one. */
  dependencies: { projectId: string; versionId: string | null }[]
  /** Projects this one says it can't run with. */
  incompatible: string[]
  /**
   * For sources that build files on request: POST this form, and download the link the
   * JSON answer gives. `url` is then only for showing.
   */
  request?: { url: string; form: Record<string, string> }
  /** The download is a zip holding the real file, as Vanilla Tweaks sends datapacks. */
  wrapped?: boolean
  /**
   * The source says it only runs on players' computers. Authors set this and it's not
   * always right, so it's installed anyway when asked for, with a warning.
   */
  clientOnly?: boolean
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
    opts: {
      kind: ContentKind
      target: ContentTarget
      limit?: number
      offset?: number
      /** Include projects marked client-only. Off by default. */
      clientOnly?: boolean
    },
  ): Promise<{ hits: ContentHit[]; total: number }>
  versions(
    project: string,
    opts: { kind: ContentKind; target: ContentTarget },
  ): Promise<ContentVersion[]>
  resolve(ref: ContentRef, target: ContentTarget): Promise<ResolvedContent>
}
