import { z } from 'zod'
import { createInvite, roleNameOf } from '../../../../../auth/people'

const Body = z.object({
  roleId: z.string().min(1).max(64),
  note: z.string().trim().max(60).nullish(),
})

/** Makes a one-time invite link for this server. The link is shown once. */
export default defineEventHandler(async (event) => {
  const { access, server } = await requireServerPermission(event, 'server.view')
  requireAccessManager(event, server)
  const { user } = await requireElevated(event)
  const body = await readValidatedBody(event, Body.parse)
  const db = useDb()
  const invite = peopleCall(() => createInvite(db, access, { ...body, server, createdBy: user.id }))
  audit(user.id, 'people.invited', server, {
    person: body.note ?? null,
    role: body.roleId,
    roleName: roleNameOf(db, body.roleId),
    server: findServer(server).displayName ?? server,
  })
  return {
    id: invite.id,
    url: panelLink(event, '/join', invite.token),
    expiresAt: invite.expiresAt,
  }
})
