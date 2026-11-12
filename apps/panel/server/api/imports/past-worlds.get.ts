import { can } from '../../../shared/permissions'
import { schema } from '../../db'

/** The past worlds of every server this person can see, which a new server can start from. */
export default defineEventHandler(async (event) => {
  const { access } = await requirePermission(event, 'servers.create')
  const servers = new Map(
    useDb()
      .select({ name: schema.servers.name, displayName: schema.servers.displayName })
      .from(schema.servers)
      .all()
      .map((s) => [s.name, s.displayName]),
  )
  return useExports()
    .pastWorlds()
    .filter((w) => can(access, 'server.view', w.server))
    .map(({ id, name, server, bytes, createdAt }) => ({
      id,
      name,
      server,
      serverName: servers.get(server) ?? server,
      bytes,
      createdAt,
    }))
})
