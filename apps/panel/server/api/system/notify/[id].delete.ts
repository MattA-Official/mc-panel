import { z } from 'zod'

const Params = z.object({ id: z.coerce.number().int() })

/** Removes a channel. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.notifications')
  const { user } = await requireElevated(event)
  const { id } = await getValidatedRouterParams(event, Params.parse)
  const removed = await notifyHttp(() => useNotify().remove(id))
  audit(user.id, 'notify.channel.remove', null, { name: removed.name, kind: removed.kind })
  return { ok: true }
})
