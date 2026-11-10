/** A file of a server's web map. */
export default defineEventHandler((event) =>
  serveMap(event, getRouterParam(event, 'name') ?? '', getRouterParam(event, 'path') ?? ''),
)
