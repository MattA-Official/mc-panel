import { z } from 'zod'

const Body = z.object({ token: z.string().trim().min(1).max(200) })

/**
 * Connects the app a bot token belongs to and points its interactions endpoint here. It
 * stores a credential and talks to Discord, so it needs a fresh passkey check.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.integrations')
  const { user } = await requireElevated(event)
  const { token } = await readValidatedBody(event, Body.parse)
  await discordHttp(() => useDiscord().connect(token))
  await syncDiscordCommands(true)
  // A new token: chat from Discord reconnects with it, if it's on.
  useDiscordGateway().stop()
  syncDiscordGateway()
  const state = useDiscord().state()
  if (state.connected) {
    audit(user.id, 'discord.connect', null, {
      applicationId: state.applicationId,
      name: state.name,
      endpointSet: state.endpointSet,
    })
  }
  return state
})
