import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { schema } from '../../../../db'

const Params = z.object({ name: z.string().max(40) })

/**
 * Takes today's stats snapshot now rather than waiting for 03:30 (it replaces today's row,
 * so it does no harm). Only players whose stats changed since their last row are stored.
 */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.configure')
  const { name } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  const tz =
    useDb()
      .select({ tz: schema.servers.timezone })
      .from(schema.servers)
      .where(eq(schema.servers.name, name))
      .get()?.tz ?? 'UTC'
  const stored = await useStatsSnapshot().take(name, tz)
  return { stored }
})
