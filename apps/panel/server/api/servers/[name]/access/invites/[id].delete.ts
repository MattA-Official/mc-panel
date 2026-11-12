import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { revokeInvite } from '../../../../../auth/people'
import { schema } from '../../../../../db'

const Params = z.object({ name: z.string().max(40), id: z.coerce.number().int().positive() })

/** Cancels an unused invite link for this server. */
export default defineEventHandler(async (event) => {
  const { server, session, access } = await requireServerPermission(event, 'server.view')
  requireAccessManager(event, server)
  const { id } = await getValidatedRouterParams(event, Params.parse)
  const db = useDb()
  const row = db.select().from(schema.invites).where(eq(schema.invites.id, id)).get()
  // An invite for another server, or for all of them, isn't this section's to cancel.
  if (!row || row.server !== server) {
    throw createError({ statusCode: 404, statusMessage: 'No such invite.' })
  }
  const invite = peopleCall(() => revokeInvite(db, access, id))
  audit(session.user.id, 'people.invite_revoked', server, {
    person: invite.note,
    role: invite.roleId,
    server: invite.server,
  })
  return { ok: true }
})
