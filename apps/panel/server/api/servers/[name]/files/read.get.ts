import { readText } from '../../../../files'

export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'files.read')
  const ctx = await fileContext(event)
  const { path } = await getValidatedQuery(event, PathQuery.parse)
  return fileAction(ctx, null, {}, async () => ({ content: await readText(ctx.root, path) }))
})
