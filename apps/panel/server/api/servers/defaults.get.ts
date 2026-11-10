import { schema } from '../../db'
import { lowestFree } from '../../jobs/runner'
import { maxHeapFor, memoryBudget } from '../../memory'

/** Sensible starting values for the wizard on this machine, and the memory budget. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'servers.create')
  const rows = useDb().select().from(schema.servers).all()
  const used = new Set(rows.flatMap((r) => [r.port, r.rconPort]))
  const jobs = useJobs()
  const totalMb = jobs.totalMemoryMb()
  const users = jobs.memoryUsers()
  const maxMemoryMb = maxHeapFor(totalMb, users)
  return {
    port: lowestFree(25565, used),
    totalMemoryMb: totalMb,
    /** The most a new server could have. */
    maxMemoryMb,
    memoryMb: Math.min(4096, maxMemoryMb),
    budget: memoryBudget(totalMb, users),
  }
})
