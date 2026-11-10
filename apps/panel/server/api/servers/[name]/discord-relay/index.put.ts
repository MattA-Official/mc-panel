import { z } from 'zod'
import { RelayInput } from '../../../../../shared/discord-relay'

const Params = z.object({ name: z.string().max(40) })

/**
 * Turns on (or changes) posting the server's chat, joins and leaves to a Discord channel. It
 * sends what players say off the machine, so it needs a fresh passkey check.
 */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.configure')
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
  })
  return view
})
