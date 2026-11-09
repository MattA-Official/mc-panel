import { z } from 'zod'
import { checkCode } from '../../auth/recovery'

const Body = z.object({ code: z.string().min(1).max(40) })

/** Proves the recovery codes were saved by typing one back. Does not use it up. */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  limit(event, 'confirm')
  const { code } = await readValidatedBody(event, Body.parse)
  if (!(await checkCode(useDb(), user.id, code))) {
    throw createError({
      statusCode: 400,
      statusMessage: "That code doesn't match. Check what you saved.",
    })
  }
  return { ok: true }
})
