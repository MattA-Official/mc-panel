import { asc } from 'drizzle-orm'
import { schema } from '../../db'

export default defineEventHandler(async () => {
  const rows = useDb().select().from(schema.servers).orderBy(asc(schema.servers.createdAt)).all()
  const statuses = await useStatus().current()
  return rows.map((r) => publicServer(r, statuses[r.name] ?? 'unknown'))
})
