import { z } from 'zod'
import { MAX_TEXT_BYTES, writeAtomic } from '../../../../files'

const Body = z.object({
  path: z.string().min(1).max(4096),
  content: z.string().max(MAX_TEXT_BYTES),
})

export default defineEventHandler(async (event) => {
  const ctx = await fileContext(event)
  const { path, content } = await readValidatedBody(event, Body.parse)
  return fileAction(ctx, 'write', { path }, async () => {
    await writeAtomic(ctx.root, path, content)
    return { ok: true }
  })
})
