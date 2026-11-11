import { and, eq, isNull, or } from 'drizzle-orm'
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
      .values(hashes.map((hash, i) => ({ userId, hash, lookup: lookupOf(codes[i]!) })))
      .run()
  })
  return codes
}

/** A code's first group, which picks out the one row worth checking (see the schema). */
function lookupOf(normalised: string): string | null {
  return /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(normalised) ? normalised.slice(0, 4) : null
}

/**
 * Finds the unused code row that matches, if any. Only rows with the same first group are
 * checked, plus any made before codes had one.
 */
async function findMatch(db: Db, code: string, userId?: number) {
  const normalised = normaliseCode(code)
  const lookup = lookupOf(normalised)
  if (!lookup) return null
  const rows = db
    .select()
    .from(recoveryCodes)
    .where(
      and(
        isNull(recoveryCodes.usedAt),
        or(eq(recoveryCodes.lookup, lookup), isNull(recoveryCodes.lookup)),
        userId === undefined ? undefined : eq(recoveryCodes.userId, userId),
      ),
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

// Sign-in attempts are checked one at a time, so however many arrive together they use one
// core and one Argon2 buffer.
let queue: Promise<unknown> = Promise.resolve()

/** Uses up a matching code and returns its owner, or null. */
export async function redeemCode(db: Db, code: string): Promise<number | null> {
  const found = queue.then(() => findMatch(db, code))
  queue = found.catch(() => {})
  const row = await found
  if (!row) return null
  // The usedAt guard makes this race-safe: only one request can flip a code to used.
  const updated = db
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(recoveryCodes.id, row.id), isNull(recoveryCodes.usedAt)))
    .returning({ id: recoveryCodes.id })
    .all()
  return updated.length === 1 ? row.userId : null
}
