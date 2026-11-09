import { z } from 'zod'

const Query = z.object({ offset: z.coerce.number().int().min(0) })

/** One chunk of an upload, at most 32 MB, appended at `offset`. */
export default defineEventHandler(async (event) => {
  const { imports, id } = await importContext(event)
  const { offset } = await getValidatedQuery(event, Query.parse)
  const body = toWebRequest(event).body
  if (!body) throw createError({ statusCode: 400, statusMessage: 'The chunk was empty.' })
  return importHttp(() => imports.append(id, offset, body))
})
