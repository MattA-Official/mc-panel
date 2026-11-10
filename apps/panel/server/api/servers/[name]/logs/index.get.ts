import { listLogs } from '../../../../logs'

export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'console.read')
  const ctx = await fileContext(event)
  return fileAction(ctx, null, {}, () => listLogs(ctx.root))
})
