import { schema } from '../../db'

/** Every server's past worlds, which a new server can start from. */
export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const servers = new Map(
    useDb()
      .select({ name: schema.servers.name, displayName: schema.servers.displayName })
      .from(schema.servers)
      .all()
      .map((s) => [s.name, s.displayName]),
  )
  return useExports()
    .pastWorlds()
    .map(({ id, name, server, bytes, createdAt }) => ({
      id,
      name,
      server,
      serverName: servers.get(server) ?? server,
      bytes,
      createdAt,
    }))
})
