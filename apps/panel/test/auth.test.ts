import { mkdtempSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { openDb, schema } from '../server/db'
import { ChallengeStore } from '../server/auth/challenges'
import {
  checkCode,
  generateCode,
  issueCodes,
  normaliseCode,
  redeemCode,
} from '../server/auth/recovery'
import {
  importTokenFile,
  MAX_ATTEMPTS,
  needsSetup,
  setTokenPlain,
  TOKEN_TTL_MS,
  verifyToken,
  markTokenUsed,
} from '../server/auth/setup-token'

describe('ChallengeStore', () => {
  it('hands a challenge back once, for the right purpose only', () => {
    const s = new ChallengeStore()
    const a = s.put('c1', 'login')
    expect(s.take(a, 'register')).toBeNull()
    const b = s.put('c2', 'login')
    expect(s.take(b, 'login')).toBe('c2')
    expect(s.take(b, 'login')).toBeNull()
  })

  it('expires after a minute', () => {
    let t = 0
    const s = new ChallengeStore(() => t)
    const a = s.put('c', 'login')
    t = 60_001
    expect(s.take(a, 'login')).toBeNull()
  })
})

describe('recovery codes', () => {
  it('look like XXXX-XXXX-XXXX in Crockford base32', () => {
    for (let i = 0; i < 50; i++)
      expect(generateCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$/)
  })

  it('forgive case, spacing and look-alike letters', () => {
    expect(normaliseCode('7k2m qx9d 4hrb')).toBe('7K2M-QX9D-4HRB')
    expect(normaliseCode('O1IL-0000-0000')).toBe('0111-0000-0000')
  })

  it('check without using up, then redeem exactly once', async () => {
    const db = openDb(':memory:')
    const u = db.insert(schema.users).values({ name: 'Matt' }).returning().get()
    const codes = await issueCodes(db, u.id)
    expect(codes).toHaveLength(10)
    expect(await checkCode(db, u.id, codes[3]!)).toBe(true)
    expect(await checkCode(db, u.id, codes[3]!)).toBe(true)
    expect(await redeemCode(db, codes[3]!.toLowerCase())).toBe(u.id)
    expect(await redeemCode(db, codes[3]!)).toBeNull()
    expect(await redeemCode(db, 'AAAA-AAAA-AAAA')).toBeNull()
  })
})

describe('setup token', () => {
  it('is needed until a passkey exists', () => {
    const db = openDb(':memory:')
    expect(needsSetup(db)).toBe(true)
    const u = db.insert(schema.users).values({ name: 'Matt' }).returning().get()
    db.insert(schema.credentials)
      .values({ id: 'c', userId: u.id, publicKey: Buffer.from([1]), nickname: 'x' })
      .run()
    expect(needsSetup(db)).toBe(false)
  })

  it('accepts the right token and locks after too many wrong ones', async () => {
    const db = openDb(':memory:')
    expect(await verifyToken(db, 'x')).toBe('missing')
    await setTokenPlain(db, 'right-token')
    expect(await verifyToken(db, ' right-token ')).toBe('ok')
    for (let i = 1; i < MAX_ATTEMPTS; i++) expect(await verifyToken(db, 'nope')).toBe('wrong')
    expect(await verifyToken(db, 'nope')).toBe('locked')
    expect(await verifyToken(db, 'right-token')).toBe('locked')
  })

  it('expires and can be used only once', async () => {
    const db = openDb(':memory:')
    await setTokenPlain(db, 't', 0)
    expect(await verifyToken(db, 't', TOKEN_TTL_MS + 1)).toBe('expired')
    await setTokenPlain(db, 't')
    markTokenUsed(db)
    expect(await verifyToken(db, 't')).toBe('used')
  })

  it("imports the installer's hash file and deletes it", async () => {
    const db = openDb(':memory:')
    const path = join(mkdtempSync(join(tmpdir(), 'ft-tok-')), 'setup-token.hash')
    writeFileSync(path, (await Bun.password.hash('from-installer')) + '\n')
    expect(importTokenFile(db, path)).toBe(true)
    expect(existsSync(path)).toBe(false)
    expect(await verifyToken(db, 'from-installer')).toBe('ok')
  })
})
