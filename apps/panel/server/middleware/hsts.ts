/**
 * Behind Caddy with a certificate, tells browsers to use HTTPS from now on. Plain-HTTP
 * access (an IP address before a hostname is set) gets nothing, so it keeps working.
 */
export default defineEventHandler((event) => {
  if (getRequestURL(event, { xForwardedProto: true }).protocol === 'https:') {
    setResponseHeader(event, 'strict-transport-security', 'max-age=31536000')
  }
})
