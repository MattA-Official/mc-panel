import { z } from 'zod'

const Body = z.object({ from: z.string().max(40) })

/** Copies another server's world over this one's, after a backup. Needs a recent passkey check. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'world.manage')
  await requireElevated(event)
  const { user, name, world } = await worldContext(event)
  const { from } = await readValidatedBody(event, Body.parse)
  findServer(from)
  const { jobId } = await worldHttp(() => world.copyWorld(name, from))
  audit(user.id, 'world.copy', name, { from, jobId })
  useStatus().poke()
  return { jobId }
})
