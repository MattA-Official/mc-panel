import { z } from 'zod'

const Params = z.object({ name: z.string().max(40) })

/** Whether the server can have a web map yet, and whether squaremap has made one. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.view')
  const { name } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  return useMap().status(name)
})
