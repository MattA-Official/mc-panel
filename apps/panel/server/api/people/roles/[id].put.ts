import { z } from 'zod'
import { saveRole } from '../../../auth/people'
import { ALL_PERMISSIONS, type Permission } from '../../../../shared/permissions'

const Params = z.object({ id: z.string().min(1).max(64) })
const Body = z.object({
  name: z.string().trim().min(1).max(40),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(50),
})

/** Changes a custom role. Everyone holding it is affected on their next request. */
export default defineEventHandler(async (event) => {
  const { access, session } = await requirePermission(event, 'people.manage')
  await requireElevated(event)
  const { id } = await getValidatedRouterParams(event, Params.parse)
  const body = await readValidatedBody(event, Body.parse)
  const role = peopleCall(() => saveRole(useDb(), access, { ...body, id }))
  audit(session.user.id, 'people.role_saved', null, { name: role.name, created: false })
  return role
})
