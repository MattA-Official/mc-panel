import { schema } from '../../../db'

/** Off-site backup targets, without their secrets, and which servers use each. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.integrations')
  const servers = useDb()
    .select({ name: schema.servers.name, target: schema.servers.offsiteTarget })
    .from(schema.servers)
    .all()
  return useOffsite()
    .targets()
    .map((t) => ({ ...t, servers: servers.filter((s) => s.target === t.id).map((s) => s.name) }))
})
