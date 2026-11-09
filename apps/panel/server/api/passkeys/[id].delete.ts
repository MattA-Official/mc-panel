import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '../../db'

const Params = z.object({ id: z.string().min(1).max(512) })

/** Removes one of your passkeys. The last one can't go, so you can always sign in. */
export default defineEventHandler(async (event) => {
  const { user } = await requireElevated(event)
  const { id } = await getValidatedRouterParams(event, Params.parse)
  const db = useDb()
  const mine = db
    .select({ id: schema.credentials.id, nickname: schema.credentials.nickname })
    .from(schema.credentials)
    .where(eq(schema.credentials.userId, user.id))
    .all()
  const target = mine.find((c) => c.id === id)
  if (!target) throw createError({ statusCode: 404, statusMessage: 'No such passkey.' })
  if (mine.length === 1) {
    throw createError({
      statusCode: 409,
      statusMessage: "That's your only passkey. Add another before removing this one.",
    })
  }
  db.delete(schema.credentials)
    .where(and(eq(schema.credentials.id, id), eq(schema.credentials.userId, user.id)))
    .run()
  audit(user.id, 'passkey.removed', null, { nickname: target.nickname })
  return { removed: target.nickname }
})
