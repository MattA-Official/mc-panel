/**
 * squaremap (https://modrinth.com/plugin/squaremap): a 2D web map that runs inside the
 * server. Flytower turns its own web server off and serves the files it writes, so nothing
 * new listens on a port. With its web server off, squaremap writes the live player list to
 * `web/tiles/players.json` as well as the tiles, so the map stays live from plain files.
 *
 * Only the keys Flytower manages are touched; squaremap fills in, and keeps, everything else.
 */
import type { LockedItem } from '../spec/lock'
import type { MapSettings } from '../../shared/map-settings'

export const SQUAREMAP = 'squaremap'

export type MapLoader = 'fabric' | 'paper' | 'vanilla'

/** Where squaremap keeps its config and web files, relative to the server folder. */
export function dataDir(loader: MapLoader): string | null {
  if (loader === 'fabric') return 'squaremap'
  if (loader === 'paper') return 'plugins/squaremap'
  return null
}

/** The folder the map is served from, relative to the server folder. */
export const webDir = (loader: MapLoader) => {
  const d = dataDir(loader)
  return d ? `${d}/web` : null
}

/** Rendered tiles: can always be made again, so backups leave them out. */
export const TILE_DIRS = ['./squaremap/web/tiles', './plugins/squaremap/web/tiles']

/** Whether the spec installed squaremap, from Modrinth or Hangar. */
export const hasSquaremap = (content: Pick<LockedItem, 'slug' | 'source' | 'kind'>[]) =>
  content.some(
    (l) =>
      (l.source === 'modrinth' || l.source === 'hangar') &&
      l.slug.toLowerCase() === SQUAREMAP &&
      l.kind !== 'datapack',
  )

export interface ConfigInput {
  map: MapSettings
  /** The machine's CPU cores; small machines get one background render worker. */
  cores: number
}

/** At or below this many cores, background rendering gets one worker so players come first. */
export const SMALL_MACHINE_CORES = 4

type Node = Record<string, unknown>

const isNode = (v: unknown): v is Node => !!v && typeof v === 'object' && !Array.isArray(v)

function child(parent: Node, key: string): Node {
  const v = parent[key]
  if (isNode(v)) return v
  const made: Node = {}
  parent[key] = made
  return made
}

/** Sets `value` at `path`, making the maps on the way. Returns whether anything changed. */
function setIn(root: Node, path: string[], value: unknown): boolean {
  let node = root
  for (const key of path.slice(0, -1)) node = child(node, key)
  const last = path.at(-1)!
  if (node[last] === value) return false
  node[last] = value
  return true
}

const hasIn = (root: Node, path: string[]) => {
  let node: unknown = root
  for (const key of path) {
    if (!isNode(node) || !(key in node)) return false
    node = node[key]
  }
  return true
}

/**
 * squaremap's config.yml with Flytower's keys set. `existing` is the file as it is (null when
 * squaremap hasn't made one yet). Returns null when nothing needs to change.
 */
export function squaremapConfig(existing: string | null, input: ConfigInput): string | null {
  let root: Node = {}
  if (existing?.trim()) {
    const parsed = Bun.YAML.parse(existing)
    if (isNode(parsed)) root = parsed
  }
  let changed = !existing
  // Flytower serves the files; squaremap's own server would open a port on every address
  // (8080 for every server, so a second one would clash).
  changed = setIn(root, ['settings', 'internal-webserver', 'enabled'], false) || changed
  const defaults = ['world-settings', 'default']
  changed = setIn(root, [...defaults, 'player-tracker', 'enabled'], input.map.players) || changed
  // Heads come from mc-heads.net by default, which would tell a third party who's viewing.
  changed = setIn(root, [...defaults, 'player-tracker', 'nameplate', 'show-head'], false) || changed
  // A suggestion, not a rule: only set when nobody has chosen already.
  const workers = [...defaults, 'map', 'render', 'background', 'workers']
  if (input.cores <= SMALL_MACHINE_CORES && !hasIn(root, workers)) {
    changed = setIn(root, workers, 1) || changed
  }
  if (!changed) return null
  return (
    '# squaremap settings. Flytower manages settings.internal-webserver.enabled and the\n' +
    '# player tracker; change those in the panel. Everything else is yours.\n' +
    Bun.YAML.stringify(root, null, 2) +
    '\n'
  )
}
