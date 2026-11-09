import { z } from 'zod'

const Body = z.union([
  z.object({ url: z.string().url().max(2000) }),
  z.object({ archive: z.string().max(200) }),
  z.object({}).strict(),
])

/** Fetches if needed, unpacks and inspects, as a job. */
export default defineEventHandler(async (event) => {
  const { user, imports, id } = await importContext(event)
  const body = await readValidatedBody(event, Body.parse)
  await importHttp(() => imports.get(id))
  const source =
    'url' in body ? { url: body.url } : 'archive' in body ? { archive: body.archive } : null
  const { jobId } = await importHttp(() => imports.unpack(id, source))
  audit(user.id, 'server.import.unpack', null, { id, ...body })
  return { jobId }
})
