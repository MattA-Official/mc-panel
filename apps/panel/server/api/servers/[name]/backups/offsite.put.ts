import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '../../../../db'
import { offsiteHttp } from '../../../../backups/offsite-http'

const Body = z.object({ target: z.number().int().nullable() })

/** Chooses where this server's backups are copied, and copies the ones it already has. */
export default defineEventHandler(async (event) => {
  const { user, name, service } = await backupContext(event)
  const { target } = await readValidatedBody(event, Body.parse)
  const offsite = useOffsite()
  const t = target === null ? null : await offsiteHttp(() => offsite.target(target))
  const db = useDb()
  db.update(schema.servers)
    .set({ offsiteTarget: target })
    .where(eq(schema.servers.name, name))
    .run()
  if (target !== null) {
    const waiting = db
      .select()
      .from(schema.backups)
      .where(and(eq(schema.backups.server, name), isNull(schema.backups.offsiteState)))
      .all()
    for (const row of waiting) offsite.queue(row)
  }
  audit(user.id, 'backup.offsite', name, { target: t?.name ?? null })
  return { backups: (await service.list(name)).length }
})
