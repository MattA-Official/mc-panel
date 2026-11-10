import { z } from 'zod'
import { schema } from '../../../db'

const Params = z.object({
  name: z.string().max(40),
  action: z.enum(['start', 'stop', 'restart']),
})

/** Start, stop or restart a server. All reversible, so a normal session is enough. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.power')
  const { user } = await requireUserSession(event)
  const { name, action } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  try {
    await powerServer(name, action)
  } finally {
    useDb()
      .insert(schema.audit)
      .values({ userId: user.id, action: `server.${action}`, target: name })
      .run()
  }
  const statuses = await useStatus().poke()
  return { status: statuses[name] ?? 'unknown' }
})
