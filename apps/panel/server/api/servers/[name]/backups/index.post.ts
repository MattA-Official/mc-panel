import { z } from 'zod'

const Body = z.object({ note: z.string().trim().max(200).optional() })

/** Starts a backup now; progress follows on `job:<id>`. */
export default defineEventHandler(async (event) => {
  const { user, name, service } = await backupContext(event)
  const { note } = await readValidatedBody(event, Body.parse)
  const { jobId } = backupHttp(() => service.backup(name, 'manual', note || null))
  audit(user.id, 'backup.create', name, { jobId, note })
  return { jobId }
})
