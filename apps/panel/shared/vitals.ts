/**
 * How a running server is doing, from its last hour of samples, for the servers overview.
 * Each figure gets a level so the card can colour it, and a reason to show on hover.
 */

export interface VitalsPoint {
  at: number
  cpu: number | null
  memMb: number | null
  mspt: number | null
}

/** Fine, getting busy, or struggling. Always shown with a shape and a word, never colour alone. */
export type Level = 'ok' | 'busy' | 'struggling'

export interface Figure {
  value: number | null
  level: Level
  /** Why it has that level, in a sentence. */
  reason: string
}

export interface Vitals {
  tick: Figure
  memory: Figure & { limitMb: number }
  cpu: Figure
  /** Tick time for each minute of the last hour, oldest first; null where none was taken. */
  spark: (number | null)[]
}

/** A tick over 50 ms means the server can't keep 20 ticks a second, so the game slows. */
export const TICK_BUSY_MS = 40
export const TICK_STRUGGLING_MS = 50
/** Memory over this share of its limit is close to running out. */
export const MEMORY_BUSY = 0.9
/** CPU (of the whole machine) over this for CPU_BUSY_MINUTES samples in a row. */
export const CPU_BUSY_PCT = 85
export const CPU_BUSY_MINUTES = 5
/** Older than this and the latest sample doesn't count as live. */
const STALE_SECONDS = 3 * 60

export function tickLevel(ms: number | null): Figure {
  if (ms === null) return { value: null, level: 'ok', reason: 'No tick time yet.' }
  if (ms > TICK_STRUGGLING_MS) {
    return {
      value: ms,
      level: 'struggling',
      reason: 'Ticks take longer than 50 ms, so the game is running slower than normal.',
    }
  }
  if (ms > TICK_BUSY_MS) {
    return {
      value: ms,
      level: 'busy',
      reason: 'Ticks are close to 50 ms, where the game starts to slow down.',
    }
  }
  return {
    value: ms,
    level: 'ok',
    reason: 'Ticks are well under 50 ms, so the game runs at full speed.',
  }
}

export function memoryLevel(mb: number | null, limitMb: number): Figure & { limitMb: number } {
  if (mb === null) return { value: null, level: 'ok', reason: 'No memory reading yet.', limitMb }
  if (limitMb > 0 && mb > limitMb * MEMORY_BUSY) {
    return {
      value: mb,
      level: 'busy',
      reason: 'Using over 90% of its memory. Give it more in Settings if this stays high.',
      limitMb,
    }
  }
  return { value: mb, level: 'ok', reason: 'Plenty of memory to spare.', limitMb }
}

/** Busy only when CPU has stayed high, so one heavy minute (a save, say) doesn't flag it. */
export function cpuLevel(recent: (number | null)[]): Figure {
  const value = recent.at(-1) ?? null
  if (value === null) return { value, level: 'ok', reason: 'No CPU reading yet.' }
  const last = recent.slice(-CPU_BUSY_MINUTES)
  if (last.length === CPU_BUSY_MINUTES && last.every((c) => c !== null && c > CPU_BUSY_PCT)) {
    return {
      value,
      level: 'busy',
      reason: `Over ${CPU_BUSY_PCT}% of the machine's CPU for ${CPU_BUSY_MINUTES} minutes.`,
    }
  }
  return { value, level: 'ok', reason: "Using a comfortable share of the machine's CPU." }
}

/**
 * The overview's figures from a server's recent samples, or null when nothing recent was
 * sampled (the server is stopped, or has only just started).
 */
export function vitals(points: VitalsPoint[], limitMb: number, nowMs: number): Vitals | null {
  const latest = points.at(-1)
  if (!latest || nowMs / 1000 - latest.at > STALE_SECONDS) return null
  const end = Math.floor(nowMs / 60_000) * 60
  const byAt = new Map(points.map((p) => [p.at, p.mspt]))
  const spark: (number | null)[] = []
  for (let at = end - 59 * 60; at <= end; at += 60) spark.push(byAt.get(at) ?? null)
  return {
    tick: tickLevel(latest.mspt),
    memory: memoryLevel(latest.memMb, limitMb),
    cpu: cpuLevel(points.map((p) => p.cpu)),
    spark,
  }
}
