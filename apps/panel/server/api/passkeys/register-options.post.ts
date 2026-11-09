import { z } from 'zod'
import { registrationOptions } from '../../auth/passkeys'
import { needsSetup } from '../../auth/setup-token'

const Body = z.object({ name: z.string().trim().min(1).max(60).optional() })

/** First-run (after the setup token) or a signed-in user adding another passkey. */
export default defineEventHandler(async (event) => {
  const db = useDb()
  const session = await getUserSession(event)
  const { name } = await readValidatedBody(event, Body.parse)
  if (needsSetup(db)) {
    if (!session.setupVerified)
      throw createError({ statusCode: 403, statusMessage: 'Enter the setup token first.' })
    return registrationOptions(db, relyingParty(event), { id: null, name: name ?? 'Owner' })
  }
  if (!session.user) throw createError({ statusCode: 401, statusMessage: 'Sign in first.' })
  return registrationOptions(db, relyingParty(event), session.user)
})
