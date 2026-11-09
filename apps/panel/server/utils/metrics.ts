import { z } from 'zod'
import { MetricsSampler, readMachine, RANGES } from '../metrics/sampler'
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
  })
  return sampler
}

export const RangeQuery = z.object({
  range: z.enum(Object.keys(RANGES) as [keyof typeof RANGES]).default('hour'),
})
