/**
 * Whether a browser sent this request from a page on another site. Browsers add Origin to
 * every POST, PUT, PATCH and DELETE and to WebSocket upgrades, and a page can't change it, so
 * an Origin that isn't the panel's own address means another page made the request. Tools
 * like curl send none and are let through; they still need a session cookie.
 */
export function fromAnotherSite(
  origin: string | null | undefined,
  host: string | null | undefined,
) {
  if (!origin) return false
  if (!host) return true
  try {
    return new URL(origin).host.toLowerCase() !== host.toLowerCase()
  } catch {
    // Includes "null", which sandboxed frames and some redirects send.
    return true
  }
}
