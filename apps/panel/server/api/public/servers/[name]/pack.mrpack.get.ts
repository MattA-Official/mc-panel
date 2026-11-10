import { ProviderError } from '@flytower/providers'
import { packFilename, packUnavailable } from '../../../../status/mrpack'

/**
 * The players' modpack for a public server, to open in the Modrinth app or Prism. Built the
 * first time it's asked for after the server's content changes.
 */
export default defineEventHandler(async (event) => {
  limit(event, 'public-pack', 30, 60_000)
  const name = getRouterParam(event, 'name') ?? ''
  const row = findPublicServer(name)
  const notFound = () => createError({ statusCode: 404, statusMessage: 'Not found.' })
  if (!row.publicPage.pack.enabled || packUnavailable(row)) throw notFound()
  const pack = await usePacks()
    .get(row, row.publicPage.pack.extras)
    .catch((err) => {
      if (err instanceof ProviderError) {
        throw createError({ statusCode: 503, statusMessage: err.message })
      }
      throw err
    })
  if (!pack.path) throw notFound()
  const filename = packFilename(row.displayName)
  const file = Bun.file(pack.path)
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')
  return new Response(file, {
    headers: {
      'content-type': 'application/x-modrinth-modpack+zip',
      'content-length': String(file.size),
      'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'public, max-age=60',
    },
  })
})
