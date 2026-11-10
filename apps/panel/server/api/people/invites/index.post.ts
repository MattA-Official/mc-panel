import { z } from 'zod'
import { createInvite } from '../../../auth/people'

const Body = z.object({
  roleId: z.string().min(1).max(64),
  server: z.string().max(40).nullable(),
  note: z.string().trim().max(60).nullish(),
})

/** Makes a one-time invite link. The link is shown once. */
export default defineEventHandler(async (event) => {
  const { access } = await requirePermission(event, 'people.manage')
  const { user } = await requireElevated(event)
  const body = await readValidatedBody(event, Body.parse)
  const db = useDb()
  const invite = peopleCall(() => createInvite(db, access, { ...body, createdBy: user.id }))
  audit(user.id, 'people.invited', null, {
    person: body.note ?? null,
    role: body.roleId,
    server: body.server,
  })
  return {
    id: invite.id,
    url: panelLink(event, '/join', invite.token),
    expiresAt: invite.expiresAt,
  }
})
