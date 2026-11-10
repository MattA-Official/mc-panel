/**
 * Where online players are, for the web map. Asked over RCON with the game's own `data`
 * command, so it works on vanilla too, and only while someone has the map open: answers are
 * kept for a few seconds and shared between everyone viewing.
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
}

/** Positions per server, asked for at most once every few seconds. */
export class PlayerPositions {
  private cache = new Map<string, { at: number; players: Promise<MapPlayer[]> }>()

  constructor(private deps: PositionDeps) {}

  get(server: string): Promise<MapPlayer[]> {
    const hit = this.cache.get(server)
    const ttl = this.deps.ttlMs ?? 3000
    if (hit && Date.now() - hit.at < ttl) return hit.players
    const players = this.ask(server).catch(() => [] as MapPlayer[])
    this.cache.set(server, { at: Date.now(), players })
    return players
  }

  forget(server: string) {
    this.cache.delete(server)
  }

  private async ask(server: string): Promise<MapPlayer[]> {
    const online = await this.deps.online(server)
    const out: MapPlayer[] = []
    // One player at a time: RCON answers in order anyway, and this keeps the server calm.
    for (const p of online) {
      if (!/^[A-Za-z0-9_]{1,16}$/.test(p.name)) continue
      const pos = parsePos(await this.deps.rcon(server, `data get entity ${p.name} Pos`))
      if (!pos) continue
      const dimension =
        parseDimension(await this.deps.rcon(server, `data get entity ${p.name} Dimension`)) ??
        'minecraft:overworld'
      out.push({ name: p.name, uuid: p.uuid, dimension, x: pos[0], y: pos[1], z: pos[2] })
    }
    return out
  }
}
