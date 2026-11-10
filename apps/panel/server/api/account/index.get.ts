import { and, asc, count, eq, isNull } from 'drizzle-orm'
import { schema } from '../../db'

/** The signed-in person's name, preferences, passkeys and how many recovery codes are left. */
export default defineEventHandler(async (event) => {
  const { session } = await requireSignedIn(event)
  const db = useDb()
  const user = db.select().from(schema.users).where(eq(schema.users.id, session.user.id)).get()!
  const passkeys = db
    .select({
      id: schema.credentials.id,
      nickname: schema.credentials.nickname,
      createdAt: schema.credentials.createdAt,
      lastUsedAt: schema.credentials.lastUsedAt,
    })
    .from(schema.credentials)
    .where(eq(schema.credentials.userId, user.id))
    .orderBy(asc(schema.credentials.createdAt))
    .all()
  const codes = db
    .select({ n: count() })
    .from(schema.recoveryCodes)
    .where(and(eq(schema.recoveryCodes.userId, user.id), isNull(schema.recoveryCodes.usedAt)))
    .get()
  return { name: user.name, theme: user.theme, passkeys, recoveryCodesLeft: codes?.n ?? 0 }
})
