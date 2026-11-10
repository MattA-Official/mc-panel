/**
 * Checks that an interaction really came from Discord: an Ed25519 signature over the
 * timestamp and the raw body, made with the app's key and checked against its public key.
 * Discord sends unsigned and badly signed requests on purpose to test endpoints, so
 * everything else on the endpoint happens only after this says yes.
 */

/** How far the timestamp may be from our clock, either way, before a request is refused. */
export const MAX_SKEW_MS = 5 * 60_000

export type Verdict = { ok: true } | { ok: false; reason: string }

const HEX = /^[0-9a-f]+$/i

function hex(s: string, bytes: number): Uint8Array<ArrayBuffer> | null {
  if (s.length !== bytes * 2 || !HEX.test(s)) return null
  const out = new Uint8Array(bytes)
  out.set(Buffer.from(s, 'hex'))
  return out
}

const keys = new Map<string, Promise<CryptoKey>>()

/** Imports (and keeps) the app's public key. */
function importKey(publicKeyHex: string): Promise<CryptoKey> | null {
  const raw = hex(publicKeyHex, 32)
  if (!raw) return null
  let key = keys.get(publicKeyHex)
  if (!key) {
    key = crypto.subtle.importKey('raw', raw, 'Ed25519', false, ['verify'])
    // One app per install; don't let a long-lived process collect keys.
    if (keys.size > 4) keys.clear()
    keys.set(publicKeyHex, key)
  }
  return key
}

export function isPublicKey(s: string): boolean {
  return hex(s, 32) !== null
}

export async function verifyInteraction(input: {
  publicKey: string
  signature: string | undefined | null
  timestamp: string | undefined | null
  body: string
  now?: number
}): Promise<Verdict> {
  const { signature, timestamp, body } = input
  if (!signature || !timestamp) return { ok: false, reason: 'unsigned' }
  const sig = hex(signature, 64)
  if (!sig) return { ok: false, reason: 'malformed signature' }
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'malformed timestamp' }
  const skew = Math.abs((input.now ?? Date.now()) - Number(timestamp) * 1000)
  if (skew > MAX_SKEW_MS) return { ok: false, reason: 'stale timestamp' }
  const key = importKey(input.publicKey)
  if (!key) return { ok: false, reason: 'no usable public key' }
  const good = await crypto.subtle
    .verify('Ed25519', await key, sig, new TextEncoder().encode(timestamp + body))
    .catch(() => false)
  return good ? { ok: true } : { ok: false, reason: 'bad signature' }
}
