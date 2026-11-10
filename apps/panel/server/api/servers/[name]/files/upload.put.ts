import { writeAtomic } from '../../../../files'

/** The request body is the file; it streams straight to disk. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'files.write')
  const ctx = await fileContext(event)
  const { path } = await getValidatedQuery(event, PathQuery.parse)
  const body = toWebRequest(event).body
  if (!body) throw createError({ statusCode: 400, statusMessage: 'No file sent.' })
  return fileAction(ctx, 'upload', { path }, async () => {
    await writeAtomic(ctx.root, path, new Response(body))
    return { ok: true }
  })
})
