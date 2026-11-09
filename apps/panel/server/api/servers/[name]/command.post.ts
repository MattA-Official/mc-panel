import { RconError } from '@flytower/rcon'
import { z } from 'zod'
import { schema } from '../../../db'

const Params = z.object({ name: z.string().max(40) })
const Body = z.object({
  command: z
    .string()
    .trim()
    .min(1)
    .max(1400)
    .transform((c) => c.replace(/^\//, '')),
})

/** Runs a console command over RCON. The reply is also echoed to every open console. */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const { command } = await readValidatedBody(event, Body.parse)
  findServer(name)
  useDb()
    .insert(schema.audit)
    .values({ userId: user.id, action: 'server.command', target: name, detail: { command } })
    .run()
  try {
    return { reply: await useConsole().command(name, command) }
  } catch (err) {
    if (err instanceof RconError) throw createError({ statusCode: 502, statusMessage: err.message })
    throw err
  }
})
