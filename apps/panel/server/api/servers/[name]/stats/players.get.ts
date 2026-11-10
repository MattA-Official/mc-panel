import { z } from 'zod'

const Params = z.object({ name: z.string().max(40) })

/** Everyone who has played on a server: first and last seen, visits and playtime. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.view')
  const { name } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  await useSessions().idle()
  return { players: useSessions().summary(name) }
})
