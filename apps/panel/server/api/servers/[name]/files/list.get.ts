import { list } from '../../../../files'

export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'files.read')
  const ctx = await fileContext(event)
  const { path } = await getValidatedQuery(event, PathQuery.parse)
  return fileAction(ctx, null, {}, () => list(ctx.root, path))
})
