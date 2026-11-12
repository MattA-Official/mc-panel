import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '../../../../db'
import {
  readStatsSettings,
  sameStatsSettings,
  StatsSettings,
} from '../../../../../shared/stats-settings'

const Params = z.object({ name: z.string().max(40) })

/**
 * Whether the server keeps player stats, and who is left out. Leaving someone out deletes
 * what was kept about them on this server; turning stats off keeps what's there.
 */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'community.manage')
  const { user } = await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const body = await readValidatedBody(event, StatsSettings.parse)
  const server = findServer(name)
  const was = readStatsSettings(server.stats)
  if (sameStatsSettings(was, body)) return { changed: false }
  useDb().update(schema.servers).set({ stats: body }).where(eq(schema.servers.name, name)).run()
  statsChanged(name, server.stats)
  const before = new Set(was.leaveOut.map((p) => p.uuid))
  audit(user.id, 'server.stats', name, {
    enabled: body.enabled,
    was: was.enabled,
    leftOut: body.leaveOut.filter((p) => !before.has(p.uuid)).map((p) => p.name),
  })
  return { changed: true }
})
