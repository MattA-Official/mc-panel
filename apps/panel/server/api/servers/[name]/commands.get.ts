import { z } from 'zod'

const Params = z.object({ name: z.string().max(40) })
const Query = z.object({ wait: z.enum(['1']).optional() })

/**
 * The commands the console can complete: the game's tree for this server's version, mod and
 * plugin commands from `help`, registry ids and who's online. Only for people who can send
 * commands. With `wait=1`, a tree still being made is waited for.
 */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'console.command')
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const { wait } = await getValidatedQuery(event, Query.parse)
  findServer(name)
  const view = await useConsoleCommands().get(name, { wait: wait === '1' })
  if (!view) throw createError({ statusCode: 404, statusMessage: `No server called ${name}.` })
  return view
})
