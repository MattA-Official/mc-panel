import { schema } from '../../db'
import { totalmem } from 'node:os'
import { lowestFree } from '../../jobs/runner'

/** Sensible starting values for the wizard on this machine. */
export default defineEventHandler(() => {
  const rows = useDb().select().from(schema.servers).all()
  const used = new Set(rows.flatMap((r) => [r.port, r.rconPort]))
  const totalMb = Math.floor(totalmem() / 1024 / 1024)
  // Leave 1.5 GB for the OS and panel, and the JVM's own overhead per server.
  const maxMemoryMb = Math.max(1024, Math.floor((totalMb - 1536) / 512) * 512 - 1024)
  return {
    port: lowestFree(25565, used),
    totalMemoryMb: totalMb,
    maxMemoryMb,
    memoryMb: Math.min(4096, maxMemoryMb),
  }
})
