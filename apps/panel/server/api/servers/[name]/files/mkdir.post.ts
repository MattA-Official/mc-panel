import { z } from 'zod'
import { makeDir } from '../../../../files'

const Body = z.object({ path: z.string().min(1).max(4096) })

export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'files.write')
  const ctx = await fileContext(event)
  const { path } = await readValidatedBody(event, Body.parse)
  return fileAction(ctx, 'mkdir', { path }, async () => {
    await makeDir(ctx.root, path)
    return { ok: true }
  })
})
