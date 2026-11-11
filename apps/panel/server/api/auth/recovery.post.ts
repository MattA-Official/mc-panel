import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { redeemCode } from '../../auth/recovery'
import { audit, users } from '../../db/schema'

const Body = z.object({ code: z.string().min(1).max(40) })

/** Signs in with a recovery code, uses it up, and requires a new passkey next. */
export default defineEventHandler(async (event) => {
  limit(event, 'recovery')
  // Each try can cost an Argon2 check, so there's a ceiling across all addresses too.
  limitAll('recovery', 60)
  const db = useDb()
  const { code } = await readValidatedBody(event, Body.parse)
  const userId = await redeemCode(db, code)
  if (userId === null) {
    throw createError({
      statusCode: 400,
      statusMessage: "That recovery code isn't valid or has been used.",
    })
  }
  const user = db.select().from(users).where(eq(users.id, userId)).get()!
  await replaceUserSession(event, {
    user: { id: user.id, name: user.name },
    sessionVersion: user.sessionVersion,
    mustEnrolPasskey: true,
  })
  db.insert(audit).values({ userId, action: 'auth.recovery_code' }).run()
  return { ok: true }
})
