import { z } from 'zod'
import { move } from '../../../../files'

const Body = z.object({ from: z.string().min(1).max(4096), to: z.string().min(1).max(4096) })

export default defineEventHandler(async (event) => {
  const ctx = await fileContext(event)
  const { from, to } = await readValidatedBody(event, Body.parse)
  return fileAction(ctx, 'rename', { from, to }, async () => {
    await move(ctx.root, from, to)
    return { ok: true }
  })
})
