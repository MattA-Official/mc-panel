import { z } from 'zod'
import { inArray } from 'drizzle-orm'
import { schema } from '../../../db'
import { setSetting } from '../../../settings'
import { MAX_MAPPINGS, SNOWFLAKE } from '../../../discord/roles'

const Mapping = z.object({
  discordRoleId: z.string().trim().regex(SNOWFLAKE, 'A Discord role ID is a long number.'),
  label: z.string().trim().min(1).max(60),
  roleId: z.string().min(1).max(40),
  server: z.string().max(40).nullable(),
})
const Body = z.object({ mappings: z.array(Mapping).max(MAX_MAPPINGS) })

/**
 * Saves which Discord roles get which Flytower roles. It hands out access, so it needs both
 * Manage integrations and Manage roles, and a fresh passkey check. Owner can't be mapped: no
 * command needs it, and a Discord role is easier to hand out than a passkey.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'roles.manage')
  await requirePermission(event, 'system.integrations')
  const { user } = await requireElevated(event)
  const { mappings } = await readValidatedBody(event, Body.parse)
  const db = useDb()
  const roleIds = [...new Set(mappings.map((m) => m.roleId))]
  const roles = new Map(
    (roleIds.length
      ? db
          .select({ id: schema.roles.id, name: schema.roles.name })
          .from(schema.roles)
          .where(inArray(schema.roles.id, roleIds))
          .all()
      : []
    ).map((r) => [r.id, r.name]),
  )
  const servers = new Set(
    db
      .select({ name: schema.servers.name })
      .from(schema.servers)
      .all()
      .map((s) => s.name),
  )
  const seen = new Set<string>()
  for (const m of mappings) {
    if (m.roleId === 'owner' || !roles.has(m.roleId)) {
      throw createError({ statusCode: 400, statusMessage: 'Pick one of the Flytower roles.' })
    }
    if (m.server !== null && !servers.has(m.server)) {
      throw createError({ statusCode: 400, statusMessage: `There's no server called ${m.server}.` })
    }
    const key = `${m.discordRoleId}:${m.roleId}:${m.server ?? '*'}`
    if (seen.has(key)) {
      throw createError({
        statusCode: 400,
        statusMessage: `${m.label} is mapped twice the same way.`,
      })
    }
    seen.add(key)
  }
  setSetting(db, 'discord.roles', mappings)
  audit(user.id, 'discord.roles', null, {
    mappings: mappings.map(
      (m) => `${m.label} gets ${roles.get(m.roleId)} on ${m.server ?? 'all servers'}`,
    ),
  })
  return { mappings }
})
