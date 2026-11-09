import { z } from 'zod'

const Body = z.object({
  label: z.string().min(1).max(2000),
  size: z.number().int().positive().nullable(),
})

/** Starts an import. For uploads, `size` is the file's size and chunks follow. */
export default defineEventHandler(async (event) => {
  const { imports } = await importContext(event)
  const { label, size } = await readValidatedBody(event, Body.parse)
  return importHttp(() => imports.start(label, size))
})
