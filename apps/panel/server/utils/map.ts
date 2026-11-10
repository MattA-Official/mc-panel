import { join } from 'node:path'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { schema } from '../db'
import { readMapSettings } from '../../shared/map-settings'
import { readPublicPage } from '../../shared/public-page'
import { can } from '../../shared/permissions'
import { loadAccess } from '../auth/access'
import { MAP_CSP, mapAccess, mapFile } from '../map/serve'
import { MapService } from '../map/service'
import { webDir, type MapLoader } from '../map/squaremap'

let service: MapService | undefined

/** The one map service for this process. */
export function useMap(): MapService {
  service ??= new MapService({
    db: useDb(),
    serverDir,
    agent,
    rcon: (name, command) =>
      useConsole().command(name, command, { echo: false, timeoutMs: 10_000 }),
  })
  return service
}

/**
 * Answers a request for a server's web map: squaremap's web folder, served as files. Anyone
 * may open a public map (with the public page on); otherwise only people who can see the
 * server. Everything else, including a server that doesn't exist, is the same 404.
 */
export async function serveMap(event: H3Event, name: string, raw: string) {
  limit(event, 'map', 3000, 60_000)
  const notFound = () => createError({ statusCode: 404, statusMessage: 'Not found.' })
  const row = useDb().select().from(schema.servers).where(eq(schema.servers.name, name)).get()
  const web = row && webDir(row.loader as MapLoader)
  if (!row || !web) throw notFound()

  const map = readMapSettings(row.map)
  const open = map.public && readPublicPage(row.publicPage).enabled
  // Only a private map looks at the session, so a public one never hands visitors a cookie.
  const session = open ? null : await getUserSession(event)
  const access = session?.user ? loadAccess(useDb(), session.user.id, session.sessionVersion) : null
  const decision = mapAccess({
    map,
    publicPage: open,
    canView: access ? can(access, 'server.view', name) : null,
  })
  let rel: string
  try {
    rel = decodeURIComponent(raw)
  } catch {
    throw notFound()
  }
  const page = rel === '' || rel === 'index.html'
  if (decision === 'sign-in' && page) return sendRedirect(event, '/login', 302)
  if (decision !== 'allow') throw notFound()

  const target = mapFile(join(serverDir(name), web), rel)
  const file = target && Bun.file(target.file)
  if (!target || !file || !(await file.exists())) throw notFound()
  setResponseHeaders(event, {
    'content-type': target.type,
    // A private map's files stay out of shared caches.
    'cache-control': open ? target.cache : target.cache.replace('public', 'private'),
    'content-security-policy': MAP_CSP,
    'last-modified': new Date(file.lastModified).toUTCString(),
  })
  return file
}
