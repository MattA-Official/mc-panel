import { z } from 'zod'
import { removePerson } from '../../auth/people'

const Params = z.object({ id: z.coerce.number().int().positive() })

/** Removes a person. Their passkeys go too, so they're signed out at once. */
export default defineEventHandler(async (event) => {
  const { access, session } = await requirePermission(event, 'people.manage')
  await requireElevated(event)
  const { id } = await getValidatedRouterParams(event, Params.parse)
  const person = peopleCall(() => removePerson(useDb(), access, id, session.user.id))
  audit(session.user.id, 'people.removed', null, { person: person.name })
  return { ok: true }
})
