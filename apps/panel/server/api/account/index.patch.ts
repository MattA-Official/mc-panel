import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '../../db'

const Body = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
})

/** Changes the signed-in person's own name or appearance. */
export default defineEventHandler(async (event) => {
  const { session } = await requireSignedIn(event)
  const body = await readValidatedBody(event, Body.parse)
  const db = useDb()
  const id = session.user.id
  const before = db.select().from(schema.users).where(eq(schema.users.id, id)).get()!
  db.update(schema.users).set(body).where(eq(schema.users.id, id)).run()
  if (body.name && body.name !== before.name) {
    audit(id, 'account.renamed', null, { from: before.name, to: body.name })
    await setUserSession(event, { user: { id, name: body.name } })
  }
  return { ok: true }
})
