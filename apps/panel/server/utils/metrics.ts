import { z } from 'zod'
import { MetricsSampler, readMachine, recent, RANGES } from '../metrics/sampler'
import { costOf } from '../memory'
import { schema } from '../db'

let sampler: MetricsSampler | undefined

/** The one metrics sampler for this process. */
export function useMetrics(): MetricsSampler {
  sampler ??= new MetricsSampler({
    db: useDb(),
    agent,
    names: () =>
      useDb()
        .select({ name: schema.servers.name })
        .from(schema.servers)
        .all()
        .map((r) => r.name),
    rcon: (name, command) => useConsole().command(name, command, { echo: false, timeoutMs: 5000 }),
    machine: () => readMachine(useRuntimeConfig().serversDir),
    onSample: (sample) => {
      afterSample(sample)
      useJobs().bus.publish('metrics', liveMetrics())
    },
  })
  return sampler
}

export const RangeQuery = z.object({
  range: z.enum(Object.keys(RANGES) as [keyof typeof RANGES]).default('hour'),
})

/** What the servers overview shows live: each server's last hour and its memory limit. */
export interface LiveMetrics {
  [server: string]: { limitMb: number; points: ReturnType<typeof recent>[string] }
}

/** Every server's last hour of figures, published after each sample on the `metrics` topic. */
export function liveMetrics(): LiveMetrics {
  const points = recent(useDb(), Date.now())
  const out: LiveMetrics = {}
  for (const row of useDb()
    .select({ name: schema.servers.name, memoryMb: schema.servers.memoryMb })
    .from(schema.servers)
    .all()) {
    out[row.name] = { limitMb: costOf(row.memoryMb), points: points[row.name] ?? [] }
  }
  return out
}
