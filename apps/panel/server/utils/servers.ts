import { defaultPublicPage } from '../../shared/public-page'
import { eq } from 'drizzle-orm'
import { schema } from '../db'
import type { ServiceState } from '../jobs/status'
import type { Health } from '../crashes/monitor'

type Row = typeof schema.servers.$inferSelect

/** A server as the browser sees it. The RCON password stays on the server. */
export function publicServer(row: Row, status: ServiceState, health?: Health) {
  return {
    name: row.name,
    displayName: row.displayName,
    loader: row.loader,
    mcVersion: row.mcVersion,
    loaderVersion: row.loaderVersion,
    javaMajor: row.javaMajor,
    memoryMb: row.memoryMb,
    port: row.port,
    hostname: row.hostname,
    createdAt: row.createdAt,
    restartWhenUnresponsive: row.restartWhenUnresponsive,
    publicPage: row.publicPage ?? defaultPublicPage(),
    status,
    health: health ?? { condition: null, crash: null },
  }
}

export type PublicServer = ReturnType<typeof publicServer>

export function findServer(name: string): Row {
  const row = useDb().select().from(schema.servers).where(eq(schema.servers.name, name)).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: `No server called ${name}.` })
  return row
}

/**
 * A server whose public page is on. Anything else, including a server that doesn't exist,
 * is the same 404, so the public routes can't be used to find out which servers there are.
 */
export function findPublicServer(
  name: string,
): Row & { publicPage: NonNullable<Row['publicPage']> } {
  const row = useDb().select().from(schema.servers).where(eq(schema.servers.name, name)).get()
  if (!row?.publicPage?.enabled) throw createError({ statusCode: 404, statusMessage: 'Not found.' })
  return row as Row & { publicPage: NonNullable<Row['publicPage']> }
}
