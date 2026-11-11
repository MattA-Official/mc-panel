import { z } from 'zod'

const Body = z.object({ enabled: z.boolean() }).strict()

/**
 * Turns chat from Discord on or off for the whole panel. On keeps a connection to Discord open
 * that reads messages in the channels the bot can see, so it needs a fresh passkey check; off
 * closes it at once. Turning it on again after it stopped tries to connect afresh.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.integrations')
  const { enabled } = await readValidatedBody(event, Body.parse)
  const { user } = enabled ? await requireElevated(event) : await requireUserSession(event)
  const discord = useDiscord()
  if (enabled && !discord.app()) {
    throw createError({ statusCode: 400, statusMessage: 'Connect a Discord app first.' })
  }
  const was = discordChatEnabled()
  setDiscordChat(enabled)
  if (was !== enabled) audit(user.id, 'discord.chat', null, { on: enabled })
  return discord.state()
})
