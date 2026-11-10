/**
 * A server's web map page, at /s/<name>/map/. The page's files are relative to it, so
 * without the trailing slash it redirects to it.
 */
export default defineEventHandler((event) => {
  const name = getRouterParam(event, 'name') ?? ''
  if (!getRequestURL(event).pathname.endsWith('/')) {
    return sendRedirect(event, `/s/${encodeURIComponent(name)}/map/`, 302)
  }
  return serveMap(event, name, '')
})
