import { eq, sql } from 'drizzle-orm'
import { schema } from '../../db'

/**
 * Ends every other session this person has, for a lost or shared device: sessions carry the
 * version they began under, and this one moves to the new version.
 */
export default defineEventHandler(async (event) => {
  const { session } = await requireSignedIn(event)
  await requireElevated(event)
  const id = session.user.id
  const row = useDb()
    .update(schema.users)
    .set({ sessionVersion: sql`${schema.users.sessionVersion} + 1` })
    .where(eq(schema.users.id, id))
    .returning({ sessionVersion: schema.users.sessionVersion })
    .get()!
  await setUserSession(event, { sessionVersion: row.sessionVersion })
  audit(id, 'auth.signed_out_everywhere', null)
  return { ok: true }
})
