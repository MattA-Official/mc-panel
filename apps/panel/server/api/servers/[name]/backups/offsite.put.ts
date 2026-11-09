import { eq } from 'drizzle-orm'
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
  if (target !== null) offsite.queueServer(name)
  audit(user.id, 'backup.offsite', name, { target: t?.name ?? null })
  return { backups: (await service.list(name)).length }
})
