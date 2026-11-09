import { lookupPlayer, offlineUuid, PLAYER_NAME, ProviderError } from '@flytower/providers'
import { RconError } from '@flytower/rcon'
import { z } from 'zod'
import { schema } from '../../../db'
import {
  addEntry,
  commandFailed,
  commandFor,
  entryFor,
  FILE_ACTIONS,
  removeEntry,
} from '../../../players'

const Params = z.object({ name: z.string().max(40) })
const Body = z.object({
  action: z.enum(['whitelist-add', 'whitelist-remove', 'op', 'deop', 'ban', 'pardon', 'kick']),
  player: z.string().regex(PLAYER_NAME, "That isn't a valid Minecraft username."),
  reason: z.string().max(200).optional(),
})

/**
 * Changes who can play. While running it goes through the console so Minecraft keeps its
 * own lists in step; while stopped it edits the JSON files directly.
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const { action, player, reason } = await readValidatedBody(event, Body.parse)
  findServer(name)
  const running = (await useStatus().current())[name] === 'active'

  let reply: string
  if (running) {
    try {
      reply = await useConsole().command(name, commandFor(action, player, reason))
    } catch (err) {
      if (err instanceof RconError)
        throw createError({ statusCode: 502, statusMessage: err.message })
      throw err
    }
    if (commandFailed(reply)) throw createError({ statusCode: 400, statusMessage: reply })
  } else {
    const plan = FILE_ACTIONS[action]
    if (!plan) {
      throw createError({ statusCode: 409, statusMessage: 'Start the server to kick players.' })
    }
    const list = await readList(name, plan.file)
    if (plan.add) {
      const onlineMode = (await readProperties(name))['online-mode'] !== 'false'
      let profile: { uuid: string; name: string } | null
      try {
        profile = onlineMode
          ? await lookupPlayer(fetch, player)
          : { uuid: offlineUuid(player), name: player }
      } catch (err) {
        if (err instanceof ProviderError)
          throw createError({ statusCode: 502, statusMessage: err.message })
        throw err
      }
      if (!profile) {
        throw createError({
          statusCode: 404,
          statusMessage: `There's no Minecraft account called ${player}.`,
        })
      }
      await writeList(name, plan.file, addEntry(list, entryFor(plan.file, profile, { reason })))
      reply = `Saved ${profile.name}. It takes effect when the server starts.`
    } else {
      await writeList(name, plan.file, removeEntry(list, player))
      reply = `Removed ${player}. It takes effect when the server starts.`
    }
  }

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
