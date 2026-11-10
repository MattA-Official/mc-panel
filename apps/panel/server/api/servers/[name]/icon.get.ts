import { z } from 'zod'
import { ICON_FILE } from '../../../icon'
import { downloadPath, FileError } from '../../../files'

const Params = z.object({ name: z.string().max(40) })

/** The server's icon, as Minecraft reads it. The URL carries a version, so it can be cached. */
export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  const found = await downloadPath(serverDir(name), ICON_FILE).catch((err) => {
    if (err instanceof FileError) return null
    throw err
  })
  if (!found) throw createError({ statusCode: 404, statusMessage: 'This server has no icon.' })
  setResponseHeaders(event, {
    'content-type': 'image/png',
    'cache-control': 'private, max-age=31536000, immutable',
  })
  return Bun.file(found.file)
})
