import { and, asc, count, eq, isNull } from 'drizzle-orm'
import { schema } from '../../db'

/** The signed-in person's passkeys and how many recovery codes they have left. */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const db = useDb()
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
  return { name: user.name, passkeys, recoveryCodesLeft: codes?.n ?? 0 }
})
