import { z } from 'zod'
import { RelayInput } from '../../../../../shared/discord-relay'

const Params = z.object({ name: z.string().max(40) })

/**
 * Turns on (or changes) posting the server's chat, joins, leaves, deaths and advancements to a
 * Discord channel, and showing that channel's messages in game. It sends what players say off
 * the machine, so it needs a fresh passkey check.
 */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'community.manage')
  const { user } = await requireElevated(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const body = await readValidatedBody(event, RelayInput.parse)
  const server = findServer(name)
  const was = server.discordRelay
  const view = await saveRelay(name, body)
  audit(user.id, 'server.discord_relay', name, {
    on: true,
    was: !!was,
    target: view.target,
    newUrl: !!body.url,
    chat: view.chat,
    joins: view.joins,
    deaths: view.deaths,
    advancements: view.advancements,
    fromDiscord: view.fromDiscord,
    wasFromDiscord: was?.fromDiscord === true,
  })
  return view
})
