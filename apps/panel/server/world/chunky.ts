/**
 * Chunky (https://modrinth.com/plugin/chunky) over RCON. Chunky keeps its own task state,
 * including across restarts, so the panel reads it rather than tracking it.
 */

export type Dimension = 'overworld' | 'the_nether' | 'the_end'
export type Shape = 'square' | 'circle'

export interface PregenOptions {
  dimension: Dimension
  /** Blocks from the centre. */
  radius: number
  /** Null for the world spawn. */
  center: { x: number; z: number } | null
  shape: Shape
}

export interface ChunkyTask {
  world: string
  percent: number
  chunks: number
  /** As Chunky shows it, like "0:12:34". */
  eta: string | null
  /** Chunks per second. */
  rate: number | null
}

const num = (s: string) => Number(s.replace(/,/g, ''))

/**
 * Reads the running tasks from `chunky progress`. One line per task, like:
 * "[Chunky] Task running for minecraft:overworld. Processed: 1234 chunks (5.67%),
 * ETA: 0:12:34, Rate: 123.4 cps, Current: 12, -3"
 */
export function parseProgress(reply: string): ChunkyTask[] {
  const out: ChunkyTask[] = []
  const re =
    /Task (?:running|finished) for (\S+?)\.? Processed: ([\d,]+) chunks \(([\d.,]+)%\)(?:, ETA: ([\d:]+))?(?:, Rate: ([\d.,]+) cps)?/gi
  for (const m of reply.matchAll(re)) {
    out.push({
      world: m[1]!,
      chunks: num(m[2]!),
      percent: Math.min(100, Number(m[3]!.replace(',', '.'))),
      eta: m[4] ?? null,
      rate: m[5] ? Number(m[5].replace(/,/g, '')) : null,
    })
  }
  return out
}

/** The commands that set up and start a task. */
export function startCommands(o: PregenOptions): string[] {
  return [
    `chunky world minecraft:${o.dimension}`,
    o.center ? `chunky center ${o.center.x} ${o.center.z}` : 'chunky spawn',
    `chunky radius ${o.radius}`,
    `chunky shape ${o.shape}`,
    'chunky start',
  ]
}

/** Chunky asks before replacing or cancelling a task. */
export const needsConfirm = (reply: string) => /\/?chunky confirm/i.test(reply)
