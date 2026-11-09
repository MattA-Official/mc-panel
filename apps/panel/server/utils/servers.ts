import { eq } from 'drizzle-orm'
import { schema } from '../db'
import type { ServiceState } from '../jobs/status'

type Row = typeof schema.servers.$inferSelect

/** A server as the browser sees it. The RCON password stays on the server. */
export function publicServer(row: Row, status: ServiceState) {
  const { rconPassword: _secret, ...rest } = row
  return { ...rest, status }
}

export type PublicServer = ReturnType<typeof publicServer>

export function findServer(name: string): Row {
  const row = useDb().select().from(schema.servers).where(eq(schema.servers.name, name)).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: `No server called ${name}.` })
  return row
}
