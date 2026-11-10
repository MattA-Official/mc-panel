import type { DiscordRolesView } from '../../../../shared/discord'
import { schema } from '../../../db'

/** The Discord role mappings, with the Flytower roles and servers they can point at. */
export default defineEventHandler(async (event): Promise<DiscordRolesView> => {
  await requirePermission(event, 'system.manage')
  const db = useDb()
  return {
    mappings: discordRoleMappings(),
    roles: db
      .select({ id: schema.roles.id, name: schema.roles.name })
      .from(schema.roles)
      .all()
      .filter((r) => r.id !== 'owner'),
    servers: db
      .select({ name: schema.servers.name, displayName: schema.servers.displayName })
      .from(schema.servers)
      .all()
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  }
})
