import { z } from 'zod'

const Params = z.object({ name: z.string().max(40) })

/** Stops posting the server's chat to Discord and forgets the webhook. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'community.manage')
  const { user } = await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const server = findServer(name)
  if (!server.discordRelay) return { changed: false }
  removeRelay(name)
  audit(user.id, 'server.discord_relay', name, { on: false, target: server.discordRelay.target })
  return { changed: true }
})
