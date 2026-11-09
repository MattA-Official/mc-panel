/**
 * Checking Flytower releases. The key is the one the installer embeds; a test keeps the two
 * the same. Only SHA256SUMS is signed: it covers every archive.
 */
import { createPublicKey, verify } from 'node:crypto'
import RELEASE_KEY from '../../../installer/release-key.pem' with { type: 'text' }

export { RELEASE_KEY }

/** True if `signature` (base64) is a valid Ed25519 signature of `sums` by `keyPem`. */
export function verifySums(sums: Uint8Array | string, signature: string, keyPem = RELEASE_KEY) {
  let key
  try {
    key = createPublicKey(keyPem)
  } catch {
    return false
  }
  const data = typeof sums === 'string' ? Buffer.from(sums) : Buffer.from(sums)
  try {
    return verify(null, data, key, Buffer.from(signature.trim(), 'base64'))
  } catch {
    return false
  }
}

/** The expected SHA-256 for `file` from a SHA256SUMS text, or null. */
export function sumFor(sums: string, file: string): string | null {
  for (const line of sums.split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim())
    if (m && m[2] === file) return m[1]!
  }
  return null
}
