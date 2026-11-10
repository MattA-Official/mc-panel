import { asc } from 'drizzle-orm'
import { can } from '../../../shared/permissions'
import { schema } from '../../db'

/** The servers this person can see. */
export default defineEventHandler(async (event) => {
  const { access } = await requireSignedIn(event)
  const rows = useDb()
    .select()
    .from(schema.servers)
    .orderBy(asc(schema.servers.createdAt))
    .all()
    .filter((r) => can(access, 'server.view', r.name))
  const statuses = await useStatus().current()
  const health = useCrashes().health(rows.map((r) => r.name))
  return rows.map((r) => publicServer(r, statuses[r.name] ?? 'unknown', health[r.name]))
})
