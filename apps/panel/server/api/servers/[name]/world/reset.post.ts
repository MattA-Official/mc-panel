import { z } from 'zod'

const Body = z.union([
  z.object({ keep: z.literal(true) }),
  z.object({ random: z.literal(true) }),
  z.object({ seed: z.string().min(1).max(64) }),
])

/** Resets the world after a backup. Needs a recent passkey check. */
export default defineEventHandler(async (event) => {
  await requireElevated(event)
  const { user, name, world } = await worldContext(event)
  const seed = await readValidatedBody(event, Body.parse)
  const { jobId } = await worldHttp(() => world.reset(name, seed))
  audit(user.id, 'world.reset', name, { ...seed, jobId })
  useStatus().poke()
  return { jobId }
})
