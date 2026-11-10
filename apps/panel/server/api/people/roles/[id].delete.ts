import { z } from 'zod'
import { deleteRole } from '../../../auth/people'

const Params = z.object({ id: z.string().min(1).max(64) })

/** Deletes a custom role nobody holds. */
export default defineEventHandler(async (event) => {
  const { access, session } = await requirePermission(event, 'roles.manage')
  await requireElevated(event)
  const { id } = await getValidatedRouterParams(event, Params.parse)
  const role = peopleCall(() => deleteRole(useDb(), access, id))
  audit(session.user.id, 'people.role_deleted', null, { name: role.name })
  return { ok: true }
})
