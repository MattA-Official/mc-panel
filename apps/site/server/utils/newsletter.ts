// Mailing list helpers. Kept free of Nuxt and Cloudflare imports so `bun test` can run them.

/**
 * The words shown beside the Subscribe button, by version. Each sign-up stores the version it
 * saw, so change the wording by adding a new entry, never by editing an old one.
 */
export const CONSENT = {
  '2026-11-12':
    'Occasional news about Flytower releases. No tracking, and you can unsubscribe at any time.',
} as const
export const CONSENT_VERSION: keyof typeof CONSENT = '2026-11-12'

/** RFC 5321 caps an address at 254 characters. */
const MAX_EMAIL = 254
// Deliberately plain: one @, something either side, a dot in the domain, no spaces or controls.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Trims and lower-cases an address, or returns null when it isn't one we'll store. */
export function normaliseEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const email = input.trim().toLowerCase()
  if (!email || email.length > MAX_EMAIL) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(email)) return null
  return EMAIL.test(email) ? email : null
}

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A fresh 32-byte token for confirm and unsubscribe links, and the hash we store for it. */
export async function newToken(): Promise<{ token: string; hash: string }> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)))
  return { token, hash: await hashToken(token) }
}

export async function hashToken(token: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
}

/** The request came from one of our own pages (blocks other sites posting the form). */
export function sameOrigin(origin: string | undefined, requestUrl: URL): boolean {
  if (!origin) return false
  try {
    return new URL(origin).host === requestUrl.host
  } catch {
    return false
  }
}
