import { z } from 'zod'

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    dimension: z.enum(['overworld', 'the_nether', 'the_end']),
    radius: z.number().int().min(16).max(100_000),
    center: z
      .object({
        x: z.number().int().min(-30_000_000).max(30_000_000),
        z: z.number().int().min(-30_000_000).max(30_000_000),
      })
      .nullable(),
    shape: z.enum(['square', 'circle']),
  }),
  z.object({ action: z.enum(['pause', 'continue', 'cancel']) }),
])

/** Starts, pauses, continues or cancels Chunky. Returns what Chunky said. */
export default defineEventHandler(async (event) => {
  const { user, name, world } = await worldContext(event)
  const body = await readValidatedBody(event, Body.parse)
  const reply = await worldHttp(() =>
    body.action === 'start'
      ? world.startPregen(name, {
          dimension: body.dimension,
          radius: body.radius,
          center: body.center,
          shape: body.shape,
        })
      : world.pregen(name, body.action),
  )
  audit(user.id, `world.pregen.${body.action}`, name, body.action === 'start' ? body : {})
  return { reply }
})
