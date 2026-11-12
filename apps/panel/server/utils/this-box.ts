const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'])

/**
 * Whether a request came straight to the panel's port from this machine, not through the
 * proxy. The installer's Caddy always sets X-Forwarded-For, so a request without it skipped
 * the proxy. Bun's server under Nitro doesn't pass the peer's address on, so when there is no
 * address the answer comes from where the panel listens: on loopback, only this machine can
 * reach it.
 */
export function isFromThisBox(input: {
  forwardedFor?: string | null
  ip?: string | null
  listenHost?: string | null
}): boolean {
  if (input.forwardedFor) return false
  if (input.ip) return LOOPBACK.has(input.ip)
  return LOOPBACK.has(input.listenHost ?? '')
}
