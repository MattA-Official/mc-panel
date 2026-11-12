import { watch } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { downloadVerified, Mojang, uuidHex } from '@flytower/providers'
import { schema } from '../db'
import { readMapSettings } from '../../shared/map-settings'
import { readPublicPage } from '../../shared/public-page'
import { can } from '../../shared/permissions'
import { loadAccess } from '../auth/access'
import { withUuids } from '../players'
import { PlayerPositions } from '../map/players'
import { MAP_CSP, mapAccess, mapFile, mapShowsPlayers, viewerPage } from '../map/serve'
import { MapService, runRenderer, type MapProgress } from '../map/service'

let service: MapService | undefined
let mojang: Mojang | undefined

/** Where the renderer is: next to Bun in the release's bin/, or wherever FLYTOWER_MAP says. */
export const mapBinary = () =>
  process.env.FLYTOWER_MAP || join(dirname(process.execPath), 'flytower-map')

/** Runs flytower-map at low CPU and disk priority, so the Minecraft servers come first. */
function runMap(args: string[], onProgress?: (p: MapProgress) => void): Promise<string> {
  const low = [
    ...(Bun.which('nice') ? ['nice', '-n', '15'] : []),
    ...(Bun.which('ionice') ? ['ionice', '-c', '3'] : []),
  ]
  return runRenderer([...low, mapBinary(), ...args], onProgress)
}

/** The one map service for this process. */
export function useMap(): MapService {
  if (service) return service
  const config = useRuntimeConfig()
  const row = (name: string) =>
    useDb().select().from(schema.servers).where(eq(schema.servers.name, name)).get()
  service = new MapService({
    mapsDir: config.mapsDir,
    serverDir,
    servers: () =>
      useDb()
        .select({ name: schema.servers.name })
        .from(schema.servers)
        .all()
        .map((r) => r.name),
    settings: (name) => {
      const r = row(name)
      return r ? readMapSettings(r.map) : null
    },
    minecraft: (name) => row(name)?.mcVersion ?? null,
    levelName: async (name) => (await readProperties(name))['level-name'] ?? null,
    async makePalette(minecraft, dest) {
      mojang ??= new Mojang(fetch)
      const jar = await mojang.clientJar(minecraft)
      const part = `${dest}.jar.part`
      try {
        await downloadVerified(fetch, jar.url, part, jar.hash)
        await runMap(['palette', '--jar', part, '--out', dest])
      } finally {
        await rm(part, { force: true })
      }
    },
    run: runMap,
    publish: (name, status) => useJobs().bus.publish(`map:${name}`, status),
    watch(dir, onSave) {
      try {
        const watcher = watch(dir, { recursive: true }, (_event, file) => {
          if (typeof file === 'string' && file.endsWith('.mca')) onSave()
        })
        watcher.on('error', (err) => console.error(`[flytower] map watch on ${dir} failed`, err))
        return () => watcher.close()
      } catch (err) {
        console.error(`[flytower] couldn't watch ${dir} for the map`, err)
        return () => {}
      }
    },
  })
  return service
}

let positions: PlayerPositions | undefined

/** Where online players are, asked over RCON only while someone has a map open. */
export function usePlayerPositions(): PlayerPositions {
  positions ??= new PlayerPositions({
    async online(server) {
      const service = (await useStatus().current())[server] ?? 'unknown'
      if (service !== 'active') return []
      const roster = await useRoster().view(server, true)
      return withUuids(roster.players ?? [], await readUserCache(server))
    },
    rcon: (server, command) =>
      useConsole().command(server, command, { echo: false, timeoutMs: 5000 }),
  })
  return positions
}

/**
 * Answers a request for a server's web map, at /s/<name>/map/<path>: the viewer page, the
 * drawn tiles and manifest, where players are, and their heads. Anyone may open a public map
 * (with the public page on); otherwise only people who can see the server. Everything else,
 * including a map that's off or a server that doesn't exist, is the same 404.
 */
export async function serveMap(event: H3Event, name: string, raw: string) {
  limit(event, 'map', 3000, 60_000)
  const notFound = () => createError({ statusCode: 404, statusMessage: 'Not found.' })
  const row = useDb().select().from(schema.servers).where(eq(schema.servers.name, name)).get()
  if (!row) throw notFound()

  const map = readMapSettings(row.map)
  const publicPage = readPublicPage(row.publicPage)
  const open = map.enabled && map.public && publicPage.enabled
  // Only a private map looks at the session, so a public one never hands visitors a cookie.
  const session = open ? null : await getUserSession(event)
  const access = session?.user ? loadAccess(useDb(), session.user.id, session.sessionVersion) : null
  const decision = mapAccess({
    map,
    publicPage: open,
    canView: access ? can(access, 'server.view', name) : null,
  })
  const showPlayers = mapShowsPlayers(map, open ? publicPage : null)
  let rel: string
  try {
    rel = decodeURIComponent(raw)
  } catch {
    throw notFound()
  }
  const page = rel === '' || rel === 'index.html'
  if (decision === 'sign-in' && page) return sendRedirect(event, '/login', 302)
  if (decision !== 'allow') throw notFound()
  // A private map's answers stay out of shared caches.
  const privately = (cache: string) => (open ? cache : cache.replace('public', 'private'))
  setResponseHeader(event, 'content-security-policy', MAP_CSP)

  if (page) {
    setResponseHeaders(event, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
    })
    return viewerPage({ title: row.displayName, version: useRuntimeConfig().version })
  }

  if (rel === 'players.json') {
    const players = showPlayers ? await usePlayerPositions().get(name) : []
    setResponseHeaders(event, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    return { players }
  }

  const head = rel.match(/^heads\/([0-9a-fA-F-]{32,36})\.png$/)
  if (head) {
    // Only for someone on the map right now, so this can't look up any player.
    const hex = uuidHex(head[1]!)
    const players = showPlayers ? await usePlayerPositions().get(name) : []
    if (!hex || !players.some((p) => p.uuid && uuidHex(p.uuid) === hex)) throw notFound()
    const png = await useSkins().skin(hex)
    if (!png) throw notFound()
    setResponseHeaders(event, {
      'content-type': 'image/png',
      'cache-control': privately('public, max-age=3600'),
    })
    return png
  }

  const target = mapFile(useMap().dir(name), rel)
  const file = target && Bun.file(target.file)
  if (!target || !file || !(await file.exists())) throw notFound()
  setResponseHeaders(event, {
    'content-type': target.type,
    'cache-control': privately(target.cache),
    'last-modified': new Date(file.lastModified).toUTCString(),
  })
  return file
}
