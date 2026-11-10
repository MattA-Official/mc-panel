import { z } from 'zod'
import { readLog } from '../../../../logs'

const Query = z.object({ name: z.string().max(255), q: z.string().max(200).default('') })

export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'console.read')
  const ctx = await fileContext(event)
  const { name, q } = await getValidatedQuery(event, Query.parse)
  return fileAction(ctx, null, {}, () => readLog(ctx.root, name, q))
})
