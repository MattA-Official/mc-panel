import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { and, eq, lt, sql } from 'drizzle-orm'
import type { Db, DbOrTx } from '../db'
import { credentials, setupToken } from '../db/schema'

/**
 * Wrong guesses before the token is dead, across everyone. The route also limits each address
 * to a few tries, so one stranger can't use them all up before the owner gets there.
 */
export const MAX_ATTEMPTS = 20
export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/** Setup is needed until the first passkey exists. */
export function needsSetup(db: DbOrTx): boolean {
  return db.select({ id: credentials.id }).from(credentials).limit(1).all().length === 0
}

/**
 * Takes the hash the installer wrote and moves it into the database, then deletes the file,
 * so the token can be replaced by re-running the installer but never read back.
 */
export function importTokenFile(db: Db, path: string, now = Date.now()): boolean {
  if (!existsSync(path)) return false
  const hash = readFileSync(path, 'utf8').trim()
  if (!hash.startsWith('$argon2')) return false
  db.insert(setupToken)
    .values({ id: 1, hash, expiresAt: new Date(now + TOKEN_TTL_MS), attempts: 0, usedAt: null })
    .onConflictDoUpdate({
      target: setupToken.id,
      set: { hash, expiresAt: new Date(now + TOKEN_TTL_MS), attempts: 0, usedAt: null },
    })
    .run()
  unlinkSync(path)
  return true
}

/** For development: set the token from plain text. */
export async function setTokenPlain(db: Db, token: string, now = Date.now()) {
  const hash = await Bun.password.hash(token)
  db.insert(setupToken)
    .values({ id: 1, hash, expiresAt: new Date(now + TOKEN_TTL_MS) })
    .onConflictDoUpdate({
      target: setupToken.id,
      set: { hash, expiresAt: new Date(now + TOKEN_TTL_MS), attempts: 0, usedAt: null },
    })
    .run()
}

export type TokenCheck = 'ok' | 'wrong' | 'expired' | 'locked' | 'missing' | 'used'

/**
 * Checks a setup token. Every wrong guess counts; after MAX_ATTEMPTS the token is dead. The
 * attempt is counted before the (slow) check, so guesses sent together can't slip past the
 * limit, and handed back if the token was right.
 */
export async function verifyToken(db: Db, token: string, now = Date.now()): Promise<TokenCheck> {
  const row = db.select().from(setupToken).where(eq(setupToken.id, 1)).get()
  if (!row) return 'missing'
  if (row.usedAt) return 'used'
  if (row.attempts >= MAX_ATTEMPTS) return 'locked'
  if (row.expiresAt.getTime() < now) return 'expired'
  const counted = db
    .update(setupToken)
    .set({ attempts: sql`${setupToken.attempts} + 1` })
    .where(and(eq(setupToken.id, 1), lt(setupToken.attempts, MAX_ATTEMPTS)))
    .returning({ attempts: setupToken.attempts })
    .get()
  if (!counted) return 'locked'
  if (await Bun.password.verify(token.trim(), row.hash)) {
    db.update(setupToken)
      .set({ attempts: sql`${setupToken.attempts} - 1` })
      .where(eq(setupToken.id, 1))
      .run()
    return 'ok'
  }
  return counted.attempts >= MAX_ATTEMPTS ? 'locked' : 'wrong'
}

export function markTokenUsed(db: DbOrTx, now = Date.now()) {
  db.update(setupToken)
    .set({ usedAt: new Date(now) })
    .where(eq(setupToken.id, 1))
    .run()
}
