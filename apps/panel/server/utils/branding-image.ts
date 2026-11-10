import type { H3Event } from 'h3'
import type { ImageSlot } from '../../shared/branding'

/**
 * Sends a stored logo or favicon, or the Flytower one when none is set. Uploads get a CSP of
 * their own that runs nothing, should an SVG ever be opened directly rather than in <img>.
 */
export function sendBrandingImage(event: H3Event, slot: ImageSlot, fallback: string) {
  const branding = useBranding()
  const img = branding.image(slot) ?? (slot === 'favicon' ? branding.image('logo') : null)
  if (!img) return sendRedirect(event, fallback, 302)
  const etag = `"${img.hash}"`
  setResponseHeaders(event, {
    'content-type': img.type,
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-site',
    // The page asks with ?v=<hash>, so a changed image is a new address.
    'cache-control':
      getQuery(event).v === img.hash ? 'public, max-age=31536000, immutable' : 'no-cache',
    etag,
  })
  if (getRequestHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return ''
  }
  return Buffer.from(img.data, 'base64')
}
