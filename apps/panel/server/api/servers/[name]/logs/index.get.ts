import { listLogs } from '../../../../logs'

export default defineEventHandler(async (event) => {
  const ctx = await fileContext(event)
  return fileAction(ctx, null, {}, () => listLogs(ctx.root))
})
