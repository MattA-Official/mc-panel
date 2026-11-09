/** Turns a list of wanted content into exact files, pulling in required dependencies. */
import type { ContentProvider, ContentRef, ContentTarget, ResolvedContent } from './content.ts'
import { ProviderError } from './types.ts'
import { resolveUrl, type UrlRef } from './url.ts'
import type { TweakType, VanillaTweaksProvider } from './vanillatweaks.ts'

export type WantedContent = (
  { modrinth: string; version?: string } | UrlRef | { vanillatweaks: string; tweak?: TweakType }
) & {
  kind?: ContentRef['kind']
}

export interface ResolvedSet {
  /** Everything to install, in a stable order: what was asked for, then dependencies. */
  items: (ResolvedContent & { requiredBy: string[] })[]
  /** Problems that should stop an apply. */
  problems: string[]
}

const MAX_ITEMS = 500

export interface ResolveOptions {
  /**
   * The version to keep for a project (by id or slug) when nothing pins one, usually from
   * the lockfile, so an apply doesn't quietly upgrade things.
   */
  pinned?: (project: string) => string | undefined
  vanillatweaks?: VanillaTweaksProvider
}

export async function resolveAll(
  wanted: WantedContent[],
  target: ContentTarget,
  modrinth: ContentProvider,
  opts: ResolveOptions = {},
): Promise<ResolvedSet> {
  const pin = (project: string, version?: string | null) =>
    version ?? opts.pinned?.(project) ?? undefined
  const byProject = new Map<string, ResolvedContent & { requiredBy: string[] }>()
  const problems: string[] = []
  const queue: { ref: ContentRef; by: string | null }[] = []

  for (const w of wanted) {
    if ('vanillatweaks' in w) {
      if (!opts.vanillatweaks) {
        problems.push('Vanilla Tweaks is turned off.')
        continue
      }
      try {
        const r = await opts.vanillatweaks.resolve(
          { pack: w.vanillatweaks, tweak: w.tweak },
          target.minecraft,
        )
        const kept = opts.pinned?.(r.projectId)
        const item = kept ? { ...r, versionId: kept, versionNumber: kept } : r
        if (byProject.has(r.projectId)) problems.push(`${r.title} is listed twice.`)
        byProject.set(r.projectId, { ...item, requiredBy: [] })
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err
        problems.push(err.message)
      }
      continue
    }
    if ('url' in w) {
      const r = resolveUrl(w)
      if (byProject.has(r.projectId)) problems.push(`${r.filename} is listed twice.`)
      byProject.set(r.projectId, { ...r, requiredBy: [] })
      continue
    }
    queue.push({
      ref: { project: w.modrinth, version: pin(w.modrinth, w.version), kind: w.kind },
      by: null,
    })
  }

  // Asked-for items first, so their pinned versions win over what a dependency would pick.
  const asked = new Set<string>()
  while (queue.length) {
    const { ref, by } = queue.shift()!
    let r: ResolvedContent
    try {
      r = await modrinth.resolve(ref, target)
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err
      problems.push(by ? `${by} needs ${ref.project}, but: ${err.message}` : err.message)
      continue
    }
    const seen = byProject.get(r.projectId)
    if (seen) {
      if (by && !seen.requiredBy.includes(by)) seen.requiredBy.push(by)
      if (!by && asked.has(r.projectId)) problems.push(`${r.title} is listed twice.`)
      if (!by) asked.add(r.projectId)
      continue
    }
    if (!by) asked.add(r.projectId)
    byProject.set(r.projectId, { ...r, requiredBy: by ? [by] : [] })
    if (byProject.size > MAX_ITEMS)
      throw new ProviderError('That is too much content for one server.')
    for (const d of r.dependencies) {
      if (byProject.has(d.projectId)) {
        const s = byProject.get(d.projectId)!
        if (!s.requiredBy.includes(r.title)) s.requiredBy.push(r.title)
        continue
      }
      queue.push({
        ref: { project: d.projectId, version: pin(d.projectId, d.versionId) },
        by: r.title,
      })
    }
  }

  const items = [...byProject.values()]
  for (const item of items) {
    for (const bad of item.incompatible) {
      const other = byProject.get(bad)
      if (other) problems.push(`${item.title} can't run alongside ${other.title}.`)
    }
  }
  const names = new Map<string, string>()
  for (const item of items) {
    const key = `${item.kind}/${item.filename}`
    const clash = names.get(key)
    if (clash) problems.push(`${item.title} and ${clash} use the same file name.`)
    names.set(key, item.title)
  }
  return { items, problems }
}
