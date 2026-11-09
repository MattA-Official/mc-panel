import { z } from 'zod'
import { PasskeyError, verifyAuthentication } from '../../auth/passkeys'

const Body = z.object({
  attemptId: z.string().min(1).max(100),
  response: z.custom<Parameters<typeof verifyAuthentication>[4]>(
    (v) => typeof v === 'object' && v !== null,
  ),
})

/** Re-confirm with a passkey before a destructive action. */
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const body = await readValidatedBody(event, Body.parse)
  try {
    const user = await verifyAuthentication(
      useDb(),
      relyingParty(event),
      'elevate',
      body.attemptId,
      body.response,
    )
    if (user.id !== session.user.id) {
      throw createError({ statusCode: 403, statusMessage: 'That passkey belongs to someone else.' })
    }
  } catch (e) {
    if (e instanceof PasskeyError) throw createError({ statusCode: 400, statusMessage: e.message })
    throw e
  }
  await setUserSession(event, { elevatedUntil: Date.now() + ELEVATION_MS })
  return { ok: true }
})
