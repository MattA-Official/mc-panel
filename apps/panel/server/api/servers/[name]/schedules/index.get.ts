import { z } from 'zod'

const Params = z.object({ name: z.string().max(40) })

/** The server's scheduled tasks, when each runs next and how each last went. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.view')
  const { name } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  return useSchedules().view(name)
})
