import { asc } from 'drizzle-orm'
import { schema } from '../../db'

export default defineEventHandler(async () => {
  const rows = useDb().select().from(schema.servers).orderBy(asc(schema.servers.createdAt)).all()
  const statuses = await useStatus().current()
  const health = useCrashes().health(rows.map((r) => r.name))
  return rows.map((r) => publicServer(r, statuses[r.name] ?? 'unknown', health[r.name]))
})
