import { z } from 'zod'

const Body = z.object({ token: z.string().trim().min(1).max(200) })

/**
 * Connects the app a bot token belongs to and points its interactions endpoint here. It
 * stores a credential and talks to Discord, so it needs a fresh passkey check.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.manage')
  const { user } = await requireElevated(event)
  const { token } = await readValidatedBody(event, Body.parse)
  const state = await discordHttp(() => useDiscord().connect(token))
  if (state.connected) {
    audit(user.id, 'discord.connect', null, {
      applicationId: state.applicationId,
      name: state.name,
      endpointSet: state.endpointSet,
    })
  }
  return state
})
