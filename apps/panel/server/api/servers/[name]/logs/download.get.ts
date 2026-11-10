import { z } from 'zod'
import { logPath } from '../../../../logs'

const Query = z.object({ name: z.string().max(255) })

/** The log as stored; rotated logs stay gzipped. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'console.read')
  const ctx = await fileContext(event)
  const { name } = await getValidatedQuery(event, Query.parse)
  const { path, size } = await fileAction(ctx, null, {}, () => logPath(ctx.root, name))
  return new Response(Bun.file(path), {
    headers: {
      'content-type': name.endsWith('.gz') ? 'application/gzip' : 'text/plain; charset=utf-8',
      'content-length': String(size),
      'content-disposition': `attachment; filename="${ctx.name}-${name}"`,
    },
  })
})
