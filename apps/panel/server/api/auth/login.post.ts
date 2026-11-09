import { z } from 'zod'
import { PasskeyError, verifyAuthentication } from '../../auth/passkeys'
import { audit } from '../../db/schema'

const Body = z.object({
  attemptId: z.string().min(1).max(100),
  response: z.custom<Parameters<typeof verifyAuthentication>[4]>(
    (v) => typeof v === 'object' && v !== null,
  ),
})

export default defineEventHandler(async (event) => {
  const db = useDb()
  const body = await readValidatedBody(event, Body.parse)
  try {
    const user = await verifyAuthentication(
      db,
      relyingParty(event),
      'login',
      body.attemptId,
      body.response,
    )
    // Signing in with a passkey proves presence, so start elevated.
    await replaceUserSession(event, {
      user: { id: user.id, name: user.name },
      elevatedUntil: Date.now() + ELEVATION_MS,
    })
    db.insert(audit).values({ userId: user.id, action: 'auth.login' }).run()
    return { ok: true }
  } catch (e) {
    if (e instanceof PasskeyError) throw createError({ statusCode: 400, statusMessage: e.message })
    throw e
  }
})
