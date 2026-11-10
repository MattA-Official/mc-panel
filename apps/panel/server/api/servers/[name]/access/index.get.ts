import { serverAccess } from '../../../../auth/people'

/** Who can reach this server and through which roles, for its Access section. */
export default defineEventHandler(async (event) => {
  const { access, server, session } = await requireServerPermission(event, 'server.view')
  requireAccessManager(event, server)
  return { ...serverAccess(useDb(), access, server), you: session.user.id }
})
