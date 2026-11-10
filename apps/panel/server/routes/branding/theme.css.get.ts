/**
 * The brand's colours and display font as CSS variables, linked from every page's <head> so
 * it applies before the first paint. Empty for Flytower's own look.
 */
export default defineEventHandler((event) => {
  const branding = useBranding()
  const etag = `"${branding.cssTag()}"`
  setResponseHeaders(event, {
    'content-type': 'text/css; charset=utf-8',
    'cache-control': 'no-cache',
    etag,
  })
  if (getRequestHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return ''
  }
  return branding.css()
})
