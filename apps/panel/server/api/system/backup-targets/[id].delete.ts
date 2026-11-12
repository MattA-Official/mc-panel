import { z } from 'zod'
import { offsiteHttp } from '../../../backups/offsite-http'

const Params = z.object({ id: z.coerce.number().int() })

/** Removes a target. Copies already in the bucket are left there. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.integrations')
  const { user } = await requireElevated(event)
  const { id } = await getValidatedRouterParams(event, Params.parse)
  const t = await offsiteHttp(() => useOffsite().removeTarget(id))
  audit(user.id, 'backup.target.remove', null, { name: t.name })
  return { ok: true }
})
