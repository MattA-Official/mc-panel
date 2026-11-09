import { z } from 'zod'
import { setSetting } from '../../../settings'

const Body = z.object({ channel: z.enum(['stable', 'beta']) })

/**
 * Chooses which releases are offered. Nothing is installed, so no passkey check here:
 * installing an update still asks for one.
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { channel } = await readValidatedBody(event, Body.parse)
  setSetting(useDb(), 'update.channel', channel)
  audit(user.id, 'update.channel', null, { channel })
  return { channel }
})
