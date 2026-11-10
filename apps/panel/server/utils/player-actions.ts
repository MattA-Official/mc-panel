import { lookupPlayer, offlineUuid, ProviderError } from '@flytower/providers'
import { RconError } from '@flytower/rcon'
import {
  addEntry,
  commandFailed,
  commandFor,
  entryFor,
  FILE_ACTIONS,
  removeEntry,
  type PlayerAction,
} from '../players'

/**
 * Changes who can play, for the Players tab and Discord alike. While running it goes through
 * the console so Minecraft keeps its own lists in step; while stopped it edits the JSON files
 * directly. Returns the reply to show; throws an HTTP error to show instead.
 */
export async function changePlayers(
  name: string,
  action: PlayerAction,
  player: string,
  reason?: string,
): Promise<string> {
  findServer(name)
  const running = (await useStatus().current())[name] === 'active'
  if (running) {
    let reply: string
    try {
      reply = await useConsole().command(name, commandFor(action, player, reason))
    } catch (err) {
      if (err instanceof RconError)
        throw createError({ statusCode: 502, statusMessage: err.message })
      throw err
    }
    if (commandFailed(reply)) throw createError({ statusCode: 400, statusMessage: reply })
    return reply
  }
  const plan = FILE_ACTIONS[action]
  if (!plan) {
    throw createError({ statusCode: 409, statusMessage: 'Start the server to kick players.' })
  }
  const list = await readList(name, plan.file)
  if (!plan.add) {
    await writeList(name, plan.file, removeEntry(list, player))
    return `Removed ${player}. It takes effect when the server starts.`
  }
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
  return `Saved ${profile.name}. It takes effect when the server starts.`
}
