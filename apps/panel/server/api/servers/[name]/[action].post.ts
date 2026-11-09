import { z } from 'zod'
import { schema } from '../../../db'

const Params = z.object({
  name: z.string().max(40),
  action: z.enum(['start', 'stop', 'restart']),
})

/** Start, stop or restart a server. All reversible, so a normal session is enough. */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { name, action } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  // The old RCON connection dies with the process; don't hand it to the next command.
  if (action !== 'start') useConsole().forget(name)
  try {
    // Stopping waits for the world to save, which can take a while on a big world.
    await agent(`service.${action}`, { server: name }, { timeoutMs: 150_000 })
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: `Couldn't ${action} ${name}: ${(err as Error).message}`,
    })
  } finally {
    useDb()
      .insert(schema.audit)
      .values({ userId: user.id, action: `server.${action}`, target: name })
      .run()
  }
  const statuses = await useStatus().poke()
  return { status: statuses[name] ?? 'unknown' }
})
