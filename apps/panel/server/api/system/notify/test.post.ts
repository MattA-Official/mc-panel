import { z } from 'zod'
import { ChannelPatch } from '../../../notify'

const Body = ChannelPatch.extend({ id: z.number().int().optional() })

/**
 * Sends a test message once and says whether it arrived. Editing a channel, the saved address
 * and secret are used for any left blank.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.notifications')
  const { id, ...input } = await readValidatedBody(event, Body.parse)
  await notifyHttp(() => useNotify().test(input, id))
  return { ok: true }
})
