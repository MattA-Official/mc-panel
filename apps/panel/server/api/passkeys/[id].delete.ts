import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '../../db'

const Params = z.object({ id: z.string().min(1).max(512) })

/**
 * Removes one of your passkeys. The last one can't go, so you can always sign in. Usually it's
 * for a lost device, which may still be signed in, so every other session ends too, as with
 * "sign out everywhere"; this one carries on.
 */
export default defineEventHandler(async (event) => {
  await requireSignedIn(event)
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
  const row = db.transaction((tx) => {
    tx.delete(schema.credentials)
      .where(and(eq(schema.credentials.id, id), eq(schema.credentials.userId, user.id)))
      .run()
    return tx
      .update(schema.users)
      .set({ sessionVersion: sql`${schema.users.sessionVersion} + 1` })
      .where(eq(schema.users.id, user.id))
      .returning({ sessionVersion: schema.users.sessionVersion })
      .get()!
  })
  await setUserSession(event, { sessionVersion: row.sessionVersion })
  audit(user.id, 'passkey.removed', null, { nickname: target.nickname })
  return { removed: target.nickname }
})
