/**
 * Requests that arrive on a server's own hostname (survival.example.com) rather than the
 * panel's domain. There, only that server's public page and what it needs are served: the
 * page's scripts and styles, the branding, the public API for that one server, and its map.
 */

export type HostDecision =
  { kind: 'panel' } | { kind: 'redirect'; to: string } | { kind: 'allow' } | { kind: 'not-found' }

const STATIC = /^\/(_nuxt|_fonts|_icons)\//
const ROOT_FILE = /^\/[\w.-]+\.(svg|ico|png|webmanifest|woff2?)$/

export function routeHost(input: {
  host: string
  path: string
  panelDomain: string
  /** The server whose hostname this is, if any. */
  server: { name: string; publicPage: boolean } | null
}): HostDecision {
  const host = input.host.toLowerCase()
  if (!input.server || !input.panelDomain || host === input.panelDomain.toLowerCase()) {
    return { kind: 'panel' }
  }
  const { name, publicPage } = input.server
  if (!publicPage) return { kind: 'not-found' }
  const path = input.path
  if (path === '/' || path === '') return { kind: 'redirect', to: `/s/${name}` }
  if (path === `/s/${name}` || path === `/s/${name}/`) return { kind: 'allow' }
  // The web map, which checks for itself who may open it.
  if (path === '/map' || path === '/map/') return { kind: 'redirect', to: `/s/${name}/map/` }
  if (path === `/s/${name}/map` || path.startsWith(`/s/${name}/map/`)) return { kind: 'allow' }
  if (path === `/api/public/servers/${name}` || path.startsWith(`/api/public/servers/${name}/`)) {
    return { kind: 'allow' }
  }
  if (path === '/api/branding' || path.startsWith('/branding/')) return { kind: 'allow' }
  if (STATIC.test(path) || ROOT_FILE.test(path)) return { kind: 'allow' }
  return { kind: 'not-found' }
}

/** Whether Caddy may get a certificate for this name: a server hostname with its page on. */
export function mayServeHost(server: { publicPage: boolean } | null): boolean {
  return !!server?.publicPage
}
