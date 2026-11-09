import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { eq } from 'drizzle-orm'
import type { Db, DbOrTx } from '../db'
import { credentials, users } from '../db/schema'
import { challenges } from './challenges'

/** Where the browser is and which domain passkeys belong to. */
export interface RelyingParty {
  id: string // hostname, e.g. panel.mc.newtheatre.org.uk
  name: string // shown by the authenticator, e.g. "Flytower"
  origin: string // https://panel.mc.newtheatre.org.uk
}

export class PasskeyError extends Error {}

/** Options for creating a passkey. `userId` is null during first-run setup. */
export async function registrationOptions(
  db: Db,
  rp: RelyingParty,
  user: { id: number | null; name: string },
) {
  const existing =
    user.id === null
      ? []
      : db.select().from(credentials).where(eq(credentials.userId, user.id)).all()
  const options = await generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.id,
    userName: user.name,
    userDisplayName: user.name,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  })
  return { options, attemptId: challenges.put(options.challenge, 'register') }
}

/** Verifies a new passkey. Returns what to store; the caller decides which user owns it. */
export async function verifyRegistration(
  rp: RelyingParty,
  attemptId: string,
  response: RegistrationResponseJSON,
) {
  const expectedChallenge = challenges.take(attemptId, 'register')
  if (!expectedChallenge) throw new PasskeyError('That request expired. Try again.')
  const v = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.id,
    requireUserVerification: true,
  }).catch((e: Error) => {
    throw new PasskeyError(e.message)
  })
  if (!v.verified || !v.registrationInfo)
    throw new PasskeyError('The passkey could not be verified.')
  const { credential, aaguid } = v.registrationInfo
  return {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    aaguid,
  }
}

export function saveCredential(
  db: DbOrTx,
  userId: number,
  cred: Awaited<ReturnType<typeof verifyRegistration>>,
  nickname: string,
) {
  db.insert(credentials)
    .values({ ...cred, userId, nickname: nickname.trim().slice(0, 60) || 'Passkey' })
    .run()
}

/** Options for signing in. Passkeys are discoverable, so no user name is needed. */
export async function authenticationOptions(rp: RelyingParty, purpose: 'login' | 'elevate') {
  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    userVerification: 'required',
  })
  return { options, attemptId: challenges.put(options.challenge, purpose) }
}

/** Verifies a sign-in, bumps the counter and returns the user it belongs to. */
export async function verifyAuthentication(
  db: Db,
  rp: RelyingParty,
  purpose: 'login' | 'elevate',
  attemptId: string,
  response: AuthenticationResponseJSON,
) {
  const expectedChallenge = challenges.take(attemptId, purpose)
  if (!expectedChallenge) throw new PasskeyError('That request expired. Try again.')
  const stored = db.select().from(credentials).where(eq(credentials.id, response.id)).get()
  if (!stored) throw new PasskeyError('This passkey is not registered here.')

  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.id,
    requireUserVerification: true,
    credential: {
      id: stored.id,
      publicKey: new Uint8Array(stored.publicKey),
      counter: stored.counter,
      transports: stored.transports as AuthenticatorTransportFuture[],
    },
  }).catch((e: Error) => {
    throw new PasskeyError(e.message)
  })
  if (!v.verified) throw new PasskeyError('The passkey could not be verified.')

  db.update(credentials)
    .set({ counter: v.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(credentials.id, stored.id))
    .run()
  const user = db.select().from(users).where(eq(users.id, stored.userId)).get()
  if (!user) throw new PasskeyError('This passkey has no owner.')
  return user
}
