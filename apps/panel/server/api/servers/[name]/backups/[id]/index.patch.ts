import { z } from 'zod'

const Body = z.object({ kept: z.boolean() })

/** Keeps a backup forever, or lets retention delete it again. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'backups.create')
  const { user, name, service } = await backupContext(event)
  const id = Number(getRouterParam(event, 'id'))
  const { kept } = await readValidatedBody(event, Body.parse)
  const row = await backupHttp(() => service.setKept(name, id, kept))
  audit(user.id, kept ? 'backup.keep' : 'backup.unkeep', name, { file: row.file })
  return { id: row.id, kept: row.kept }
})
