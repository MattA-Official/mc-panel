import { z } from 'zod'
import { saveRole } from '../../../auth/people'
import { ALL_PERMISSIONS, type Permission } from '../../../../shared/permissions'

const Body = z.object({
  name: z.string().trim().min(1).max(40),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(50),
})

/** Makes a custom role. */
export default defineEventHandler(async (event) => {
  const { access, session } = await requirePermission(event, 'roles.manage')
  await requireElevated(event)
  const body = await readValidatedBody(event, Body.parse)
  const role = peopleCall(() => saveRole(useDb(), access, body))
  audit(session.user.id, 'people.role_saved', null, { name: role.name, created: true })
  return role
})
