import { z } from 'zod'
import { JobError } from '../../../../jobs/runner'

const Params = z.object({ name: z.string().max(40) })
const Body = z.object({
  action: z.enum(['full', 'cancel']),
  dimension: z.enum(['overworld', 'the_nether', 'the_end']).default('overworld'),
})

/** Draws every explored part of a dimension on the web map, or stops drawing. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'world.manage')
  const { user } = await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const body = await readValidatedBody(event, Body.parse)
  findServer(name)
  let reply: string
  try {
    reply = await useMap().render(name, body.action, body.dimension)
  } catch (err) {
    if (err instanceof JobError) throw createError({ statusCode: 409, statusMessage: err.message })
    throw err
  }
  audit(user.id, `map.render.${body.action}`, name, { dimension: body.dimension })
  return { reply }
})
