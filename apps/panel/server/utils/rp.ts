import type { H3Event } from 'h3'
import type { RelyingParty } from '../auth/passkeys'

/**
 * The relying party for passkeys. Behind Caddy the browser's origin is https, so trust the
 * forwarded protocol and host; NUXT_RP_ID pins the domain if it ever needs to differ.
 */
export function relyingParty(event: H3Event): RelyingParty {
  const url = getRequestURL(event, { xForwardedProto: true, xForwardedHost: true })
  const { rpId } = useRuntimeConfig()
  return { id: rpId || url.hostname, name: 'Flytower', origin: url.origin }
}
