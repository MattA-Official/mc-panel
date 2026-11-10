import { PLAYER_NAME } from '@flytower/providers'
import { z } from 'zod'
import { schema } from '../../../db'

const Params = z.object({ name: z.string().max(40) })
const Body = z.object({
  action: z.enum(['whitelist-add', 'whitelist-remove', 'op', 'deop', 'ban', 'pardon', 'kick']),
  player: z.string().regex(PLAYER_NAME, "That isn't a valid Minecraft username."),
  reason: z.string().max(200).optional(),
})

/** Changes who can play: whitelist, operators, bans and kicks. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'players.manage')
  const { user } = await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const { action, player, reason } = await readValidatedBody(event, Body.parse)
  const reply = await changePlayers(name, action, player, reason)
  useDb()
    .insert(schema.audit)
    .values({
      userId: user.id,
      action: `players.${action}`,
      target: name,
      detail: { player, reason },
    })
    .run()
  return { reply }
})
