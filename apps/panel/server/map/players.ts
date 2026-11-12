/**
 * Where online players are, for the web map. Asked over RCON with the game's own `data`
 * command, so it works on vanilla too, and only while someone has the map open: answers are
 * kept for a second and shared between everyone viewing. Each player's dimension is asked
 * for less often, since it rarely changes: again after a while, or when they jump far.
 */

export interface MapPlayer {
  name: string
  /** Dashed UUID, for the head, when the server's user cache knows it. */
  uuid: string | null
  dimension: string
  x: number
  y: number
  z: number
}

const NUMBER = String.raw`(-?\d+(?:\.\d+)?(?:E-?\d+)?)[dD]?`
const POS = new RegExp(String.raw`\[\s*${NUMBER}\s*,\s*${NUMBER}\s*,\s*${NUMBER}\s*\]`)

/** `Steve has the following entity data: [12.5d, 64.0d, -3.2d]` to its numbers. */
export function parsePos(reply: string): [number, number, number] | null {
  const m = reply.match(POS)
  if (!m) return null
  const xyz = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number]
  return xyz.every(Number.isFinite) ? xyz : null
}

/** `Steve has the following entity data: "minecraft:the_nether"` to the dimension id. */
export function parseDimension(reply: string): string | null {
  const m = reply.match(/"([a-z0-9_.-]+:[a-z0-9_./-]+)"/)
  return m ? m[1]! : null
}

export interface PositionDeps {
  /** Who's online, with UUIDs where known. Empty when the server isn't running. */
  online: (server: string) => Promise<{ name: string; uuid: string | null }[]>
  rcon: (server: string, command: string) => Promise<string>
  /** How long an answer is kept. */
  ttlMs?: number
  /** How long a player's dimension is trusted before it's asked for again. */
  dimensionMs?: number
}

/** Further than this between answers means a portal or teleport: ask the dimension again. */
const JUMP = 64

/** Positions per server, asked for at most once every few seconds. */
export class PlayerPositions {
  /** Per server: the last answer, or the sweep under way (`at` is null until it's done). */
  private cache = new Map<string, { at: number | null; players: Promise<MapPlayer[]> }>()
  /** Per server, then per player: the last answer and when the dimension was asked. */
  private known = new Map<string, Map<string, { player: MapPlayer; dimensionAt: number }>>()

  constructor(private deps: PositionDeps) {}

  /**
   * Where everyone is. A sweep still under way is shared, however long RCON takes, so a slow
   * server never has two sweeps at once; a finished one is kept for the time to live.
   */
  get(server: string): Promise<MapPlayer[]> {
    const hit = this.cache.get(server)
    const ttl = this.deps.ttlMs ?? 1000
    if (hit && (hit.at === null || Date.now() - hit.at < ttl)) return hit.players
    const entry: { at: number | null; players: Promise<MapPlayer[]> } = {
      at: null,
      players: this.ask(server)
        .catch(() => [] as MapPlayer[])
        .finally(() => {
          entry.at = Date.now()
        }),
    }
    this.cache.set(server, entry)
    return entry.players
  }

  forget(server: string) {
    this.cache.delete(server)
    this.known.delete(server)
  }

  private async ask(server: string): Promise<MapPlayer[]> {
    const online = await this.deps.online(server)
    const before = this.known.get(server) ?? new Map()
    const after = new Map<string, { player: MapPlayer; dimensionAt: number }>()
    const out: MapPlayer[] = []
    // One player at a time: RCON answers in order anyway, and this keeps the server calm.
    for (const p of online) {
      if (!/^[A-Za-z0-9_]{1,16}$/.test(p.name)) continue
      const pos = parsePos(await this.deps.rcon(server, `data get entity ${p.name} Pos`))
      if (!pos) continue
      const last = before.get(p.name)
      const now = Date.now()
      const fresh =
        last &&
        now - last.dimensionAt < (this.deps.dimensionMs ?? 10_000) &&
        Math.hypot(pos[0] - last.player.x, pos[2] - last.player.z) <= JUMP
      const dimension = fresh
        ? last.player.dimension
        : (parseDimension(await this.deps.rcon(server, `data get entity ${p.name} Dimension`)) ??
          'minecraft:overworld')
      const player = { name: p.name, uuid: p.uuid, dimension, x: pos[0], y: pos[1], z: pos[2] }
      after.set(p.name, { player, dimensionAt: fresh ? last.dimensionAt : now })
      out.push(player)
    }
    this.known.set(server, after)
    return out
  }
}
