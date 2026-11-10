import { basename } from 'node:path'
import { downloadPath } from '../../../../files'

/** Streams one file back as a download. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'files.read')
  const ctx = await fileContext(event)
  const { path } = await getValidatedQuery(event, PathQuery.parse)
  const { file, size } = await fileAction(ctx, null, {}, () => downloadPath(ctx.root, path))
  const name = basename(file).replace(/["\\\r\n]/g, '_')
  return new Response(Bun.file(file), {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(size),
      'content-disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(basename(file))}`,
    },
  })
})
