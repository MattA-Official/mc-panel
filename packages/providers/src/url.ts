/** The escape hatch: any https file, as long as its SHA-256 is given. */
import type { ContentKind, ResolvedContent } from './content.ts'
import { ProviderError } from './types.ts'

export interface UrlRef {
  url: string
  sha256: string
  kind: ContentKind
  filename?: string
}

export function resolveUrl(ref: UrlRef): ResolvedContent {
  let url: URL
  try {
    url = new URL(ref.url)
  } catch {
    throw new ProviderError(`"${ref.url}" isn't a link.`)
  }
  if (url.protocol !== 'https:') throw new ProviderError('Content links must be https.')
  if (!/^[a-f0-9]{64}$/i.test(ref.sha256)) {
    throw new ProviderError('A link needs its SHA-256 so the download can be checked.')
  }
  const filename = ref.filename ?? decodeURIComponent(url.pathname.split('/').pop() ?? '')
  const jar = ref.kind !== 'datapack'
  const ext = jar ? /\.jar$/i : /\.zip$/i
  if (!/^[\w.+-]{1,160}$/.test(filename) || !ext.test(filename)) {
    throw new ProviderError(`Give this link a file name ending in ${jar ? '.jar' : '.zip'}.`)
  }
  const sha = ref.sha256.toLowerCase()
  return {
    source: 'url',
    projectId: url.href,
    slug: filename.replace(/\.(jar|zip)$/i, ''),
    title: filename,
    versionId: sha.slice(0, 12),
    versionNumber: sha.slice(0, 12),
    kind: ref.kind,
    filename,
    url: url.href,
    hash: { algorithm: 'sha256', value: sha },
    size: null,
    dependencies: [],
    incompatible: [],
  }
}
