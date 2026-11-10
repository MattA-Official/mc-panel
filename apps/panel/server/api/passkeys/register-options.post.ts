import { z } from 'zod'
import { registrationOptions } from '../../auth/passkeys'
import { inviteById } from '../../auth/people'
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
  if (!session.user && session.inviteId !== undefined) {
    // Joining through an invite link: the link was the check.
    if (!inviteById(db, session.inviteId)) {
      throw createError({
        statusCode: 410,
        statusMessage: 'This invite link has expired or was cancelled.',
      })
    }
    if (!name) throw createError({ statusCode: 400, statusMessage: 'Enter your name.' })
    return registrationOptions(db, relyingParty(event), { id: null, name })
  }
  if (!session.user) throw createError({ statusCode: 401, statusMessage: 'Sign in first.' })
  // A stolen session mustn't be able to plant its own passkey. After a recovery-code sign-in
  // the code itself was the check.
  if (!session.mustEnrolPasskey) await requireElevated(event)
  return registrationOptions(db, relyingParty(event), session.user)
})
