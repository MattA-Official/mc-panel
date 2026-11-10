import { z } from 'zod'
import { checkInvite, describeInvite } from '../../auth/people'

const Body = z.object({ token: z.string().min(1).max(200) })

/**
 * Opens an invite link. A good token is remembered in this browser's session (by invite id,
 * never the token) so the next step can create the passkey; the invite is used up only then.
 */
export default defineEventHandler(async (event) => {
  limit(event, 'join')
  const session = await getUserSession(event)
  if (session.user) {
    throw createError({
      statusCode: 409,
      statusMessage: "You're signed in already. Sign out first to join as someone new.",
    })
  }
  const { token } = await readValidatedBody(event, Body.parse)
  const db = useDb()
  const found = checkInvite(db, token)
  if (!found.ok) throw createError({ statusCode: 400, statusMessage: found.reason })
  await replaceUserSession(event, { inviteId: found.invite.id })
  return describeInvite(db, found.invite)
})
