import { z } from 'zod'
import { ChannelPatch } from '../../../notify'

const Params = z.object({ id: z.coerce.number().int() })

/** Changes a channel. Leave the address or secret out to keep the saved one. */
export default defineEventHandler(async (event) => {
  const { user } = await requireElevated(event)
  const { id } = await getValidatedRouterParams(event, Params.parse)
  const body = await readValidatedBody(event, ChannelPatch.parse)
  const changed = await notifyHttp(() => useNotify().update(id, body))
  audit(user.id, 'notify.channel.edit', null, {
    name: changed.name,
    kind: changed.kind,
    target: changed.target,
    events: changed.events,
    enabled: changed.enabled,
    newAddress: !!body.url,
  })
  return changed
})
