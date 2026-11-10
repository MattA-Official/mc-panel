import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '../../../db'

const Params = z.object({ name: z.string().max(40) })
const Body = z.object({ restartWhenUnresponsive: z.boolean() }).strict()

/** Whether to restart a server automatically when its console stops answering. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.configure')
  const { user } = await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const body = await readValidatedBody(event, Body.parse)
  const server = findServer(name)
  if (server.restartWhenUnresponsive === body.restartWhenUnresponsive) return { changed: false }
  useDb()
    .update(schema.servers)
    .set({ restartWhenUnresponsive: body.restartWhenUnresponsive })
    .where(eq(schema.servers.name, name))
    .run()
  audit(user.id, 'server.recovery', name, { restartWhenUnresponsive: body.restartWhenUnresponsive })
  return { changed: true }
})
