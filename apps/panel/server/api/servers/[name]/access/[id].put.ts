import { z } from 'zod'
import { grantChanges, setServerGrants } from '../../../../auth/people'

const Params = z.object({ id: z.coerce.number().int().positive() })
const Body = z.object({ roles: z.array(z.string().min(1).max(64)).max(20) })

/** Sets the roles a person has on this server alone. Takes effect on their next request. */
export default defineEventHandler(async (event) => {
  const { access, server } = await requireServerPermission(event, 'server.view')
  requireAccessManager(event, server)
  const { user } = await requireElevated(event)
  const { id } = await getValidatedRouterParams(event, Params.parse)
  const { roles } = await readValidatedBody(event, Body.parse)
  const db = useDb()
  const done = peopleCall(() => setServerGrants(db, access, id, server, roles))
  audit(user.id, 'people.changed', server, {
    person: done.user.name,
    ...grantChanges(db, done.before, done.after),
  })
  return { ok: true }
})
