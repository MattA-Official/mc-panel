import { ICON_FILE } from '../../../../icon'
import { downloadPath, FileError } from '../../../../files'

/** The icon of a server whose public page is on. The URL carries a version, so it's cached. */
export default defineEventHandler(async (event) => {
  limit(event, 'public', 120, 60_000)
  const name = getRouterParam(event, 'name') ?? ''
  findPublicServer(name)
  const found = await downloadPath(serverDir(name), ICON_FILE).catch((err) => {
    if (err instanceof FileError) return null
    throw err
  })
  if (!found) throw createError({ statusCode: 404, statusMessage: 'Not found.' })
  setResponseHeaders(event, {
    'content-type': 'image/png',
    'cache-control': 'public, max-age=31536000, immutable',
  })
  return Bun.file(found.file)
})
