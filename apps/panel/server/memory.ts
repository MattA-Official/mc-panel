/**
 * The memory budget: how much of the machine servers have been given. Each server costs
 * its heap plus what Java needs around it; the system and the panel keep a reserve.
 */
import { totalmem } from 'node:os'

/** Left for the system, the panel and the agent. */
export const SYSTEM_RESERVE_MB = 1024
/** Java's own use beyond the heap, typically. (The hard limit is heap + 1 GB.) */
export const JVM_OVERHEAD_MB = 512
const STEP_MB = 512

export interface MemoryUser {
  name: string
  displayName: string
  memoryMb: number
}

export interface MemoryBudget {
  totalMb: number
  /** What servers may be given in all. */
  budgetMb: number
  /** Heap plus overhead, summed. */
  givenMb: number
  freeMb: number
  servers: (MemoryUser & { costMb: number })[]
}

export const machineMemoryMb = () => Math.floor(totalmem() / 1024 / 1024)

export const costOf = (heapMb: number) => heapMb + JVM_OVERHEAD_MB

export function memoryBudget(totalMb: number, servers: MemoryUser[]): MemoryBudget {
  const budgetMb = Math.max(0, totalMb - SYSTEM_RESERVE_MB)
  const list = servers.map((s) => ({ ...s, costMb: costOf(s.memoryMb) }))
  const givenMb = list.reduce((n, s) => n + s.costMb, 0)
  return { totalMb, budgetMb, givenMb, freeMb: Math.max(0, budgetMb - givenMb), servers: list }
}

/** The most heap one server could have, counting everything else as it is. */
export function maxHeapFor(totalMb: number, servers: MemoryUser[], name?: string): number {
  const others = memoryBudget(
    totalMb,
    servers.filter((s) => s.name !== name),
  )
  const room = others.budgetMb - others.givenMb - JVM_OVERHEAD_MB
  return Math.max(0, Math.floor(room / STEP_MB) * STEP_MB)
}

const gb = (mb: number) => `${(mb / 1024).toFixed(1).replace(/\.0$/, '')} GB`

/**
 * Null if `name` can have `memoryMb` of heap, otherwise why not. Lowering memory is always
 * fine, even on a machine that's already over (say, after moving to a smaller one).
 */
export function budgetProblem(
  totalMb: number,
  servers: MemoryUser[],
  change: { name: string; memoryMb: number },
): string | null {
  const current = servers.find((s) => s.name === change.name)
  if (current && change.memoryMb <= current.memoryMb) return null
  const max = maxHeapFor(totalMb, servers, change.name)
  if (change.memoryMb <= max) return null
  const others = servers
    .filter((s) => s.name !== change.name)
    .sort((a, b) => b.memoryMb - a.memoryMb)
    .map((s) => `${s.displayName} has ${gb(s.memoryMb)}`)
  return (
    `${gb(change.memoryMb)} is more than this machine has room for: at most ${gb(max)}. ` +
    (others.length
      ? `${others.join(', ')}. Lower another server's memory first.`
      : `It has ${gb(totalMb)} in all, and keeps ${gb(SYSTEM_RESERVE_MB)} for itself.`)
  )
}
