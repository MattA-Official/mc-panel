/**
 * Serving the web map's files: which file a request means, who may have it, and how long
 * browsers may keep it. The files are squaremap's own web folder, read as they are.
 */
import { resolve, sep } from 'node:path'
import type { MapSettings } from '../../shared/map-settings'

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
}

const extension = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase()

export interface MapFile {
  /** Absolute, and always inside the web folder. */
  file: string
  type: string
  cache: string
}

/**
 * The file under `root` for the request path after `/map/` (already URL-decoded), or null
 * for anything outside the folder, hidden, or not a web file. An empty path is the page.
 */
export function mapFile(root: string, rel: string): MapFile | null {
  const path = rel === '' || rel.endsWith('/') ? `${rel}index.html` : rel
  if (path.includes('\0') || path.includes('\\')) return null
  const parts = path.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..' || p.startsWith('.'))) return null
  const type = TYPES[extension(path)]
  if (!type) return null
  const base = resolve(root)
  const file = resolve(base, path)
  if (!file.startsWith(base + sep)) return null
  return { file, type, cache: cacheFor(path) }
}

/**
 * The page and the live data are always asked for again; tiles change as the world does,
 * so a minute; squaremap's scripts and styles have content hashes in their names.
 */
export function cacheFor(path: string): string {
  if (path.endsWith('.html') || path.endsWith('.json')) return 'no-cache'
  if (path.startsWith('tiles/')) return 'public, max-age=60'
  if (path.startsWith('assets/')) return 'public, max-age=604800, immutable'
  return 'public, max-age=3600'
}

export type MapAccess = 'allow' | 'sign-in' | 'not-found'

/**
 * Who may open a server's map. A public map needs the public page on too, so turning the
 * page off hides everything at once. Everyone else needs to be able to see the server.
 */
export function mapAccess(input: {
  map: MapSettings
  publicPage: boolean
  /** Null when nobody is signed in. */
  canView: boolean | null
}): MapAccess {
  if (input.map.public && input.publicPage) return 'allow'
  if (input.canView === null) return 'sign-in'
  return input.canView ? 'allow' : 'not-found'
}

/**
 * Only what squaremap's page needs: its own scripts and styles, and images from the panel.
 * Nothing loads from other sites, and the page can't be framed.
 */
export const MAP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')
