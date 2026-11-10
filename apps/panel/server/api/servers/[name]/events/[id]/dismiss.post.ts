import { z } from 'zod'

const Params = z.object({ name: z.string().max(40), id: z.coerce.number().int().positive() })

/** Hides a crash's banner, and any older ones. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.power')
  const { name, id } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  if (!useCrashes().dismiss(name, id)) {
    throw createError({ statusCode: 404, statusMessage: 'No such event.' })
  }
  return { ok: true }
})
