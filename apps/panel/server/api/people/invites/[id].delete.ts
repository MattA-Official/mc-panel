import { z } from 'zod'
import { revokeInvite } from '../../../auth/people'

const Params = z.object({ id: z.coerce.number().int().positive() })

/** Cancels an invite link nobody has used yet. */
export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, 'people.manage')
  const { id } = await getValidatedRouterParams(event, Params.parse)
  const invite = peopleCall(() => revokeInvite(useDb(), id))
  audit(session.user.id, 'people.invite_revoked', null, {
    person: invite.note,
    role: invite.roleId,
    server: invite.server,
  })
  return { ok: true }
})
