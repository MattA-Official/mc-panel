import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { currentGrants, grantChanges, setGrants } from '../../../auth/people'
import { schema } from '../../../db'

const Params = z.object({ id: z.coerce.number().int().positive() })
const Body = z.object({
  grants: z
    .array(z.object({ roleId: z.string().min(1).max(64), server: z.string().max(40).nullable() }))
    .max(100),
})

/** Sets what a person can do. Takes effect on their next request. */
export default defineEventHandler(async (event) => {
  const { access, session } = await requirePermission(event, 'people.manage')
  await requireElevated(event)
  const { id } = await getValidatedRouterParams(event, Params.parse)
  const { grants } = await readValidatedBody(event, Body.parse)
  const db = useDb()
  const person = db.select().from(schema.users).where(eq(schema.users.id, id)).get()
  if (!person) throw createError({ statusCode: 404, statusMessage: 'No such person.' })
  const before = currentGrants(db, id)
  peopleCall(() => setGrants(db, access, id, grants))
  audit(session.user.id, 'people.changed', null, {
    person: person.name,
    grants,
    ...grantChanges(db, before, grants),
  })
  return { ok: true }
})
