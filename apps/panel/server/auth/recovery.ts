import { and, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db'
import { recoveryCodes } from '../db/schema'

// Crockford base32: no I, L, O or U, so codes survive being read aloud or written down.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const CODE_COUNT = 10

/** One code, e.g. `7K2M-QX9D-4HRB` (12 symbols, 60 bits). */
export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  const chars = [...bytes].map((b) => ALPHABET[b & 31])
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join('')).join('-')
}

/** Accepts lower case, spaces and the look-alikes people type (O for 0, I and L for 1). */
export function normaliseCode(input: string): string {
  const raw = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  return raw.length === 12 ? `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}` : raw
}

/** Replaces a user's codes with a fresh set and returns them in plain text, once. */
export async function issueCodes(db: Db, userId: number): Promise<string[]> {
  const codes = Array.from({ length: CODE_COUNT }, generateCode)
  const hashes = await Promise.all(codes.map((c) => Bun.password.hash(c)))
  db.transaction((tx) => {
    tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId)).run()
    tx.insert(recoveryCodes)
      .values(hashes.map((hash) => ({ userId, hash })))
      .run()
  })
  return codes
}

/** Finds the unused code row that matches, if any. */
async function findMatch(db: Db, code: string, userId?: number) {
  const normalised = normaliseCode(code)
  const rows = db
    .select()
    .from(recoveryCodes)
    .where(
      userId === undefined
        ? isNull(recoveryCodes.usedAt)
        : and(isNull(recoveryCodes.usedAt), eq(recoveryCodes.userId, userId)),
    )
    .all()
  for (const row of rows) {
    if (await Bun.password.verify(normalised, row.hash)) return row
  }
  return null
}

/** True if the code matches one of the user's unused codes. Does not use it up. */
export async function checkCode(db: Db, userId: number, code: string): Promise<boolean> {
  return (await findMatch(db, code, userId)) !== null
}

/** Uses up a matching code and returns its owner, or null. */
export async function redeemCode(db: Db, code: string): Promise<number | null> {
  const row = await findMatch(db, code)
  if (!row) return null
  const res = db
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(recoveryCodes.id, row.id), isNull(recoveryCodes.usedAt)))
    .run()
  return res.changes === 1 ? row.userId : null
}
