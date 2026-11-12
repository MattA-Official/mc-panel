import { schema } from '../../db'
import type { Interaction } from '../../discord/interactions'
import { route } from '../../discord/registry'
import { discordActor, viaDiscord } from '../../discord/roles'
import { verifyInteraction } from '../../discord/verify'

/**
 * Discord's interactions endpoint. Open without signing in (Discord is the caller), so
 * nothing happens until the Ed25519 signature checks out against the connected app's
 * public key. Discord itself sends badly signed requests to check this, and expects a 401.
 */
export default defineEventHandler(async (event) => {
  const app = useDiscord().app()
  if (!app) throw createError({ statusCode: 404, statusMessage: 'No Discord app is connected.' })
  const body = (await readRawBody(event, 'utf8')) ?? ''
  const verdict = await verifyInteraction({
    publicKey: app.publicKey,
    signature: getRequestHeader(event, 'x-signature-ed25519'),
    timestamp: getRequestHeader(event, 'x-signature-timestamp'),
    body,
  })
  if (!verdict.ok) throw createError({ statusCode: 401, statusMessage: 'Bad request signature.' })
  let interaction: Interaction
  try {
    interaction = JSON.parse(body) as Interaction
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Not JSON.' })
  }
  if (interaction.application_id !== app.applicationId) {
    throw createError({ statusCode: 401, statusMessage: 'Not for this app.' })
  }
  return route(useCommands(), interaction, discordAccessFor, {
    refused(ctx, command) {
      const server = typeof ctx.options.server === 'string' ? ctx.options.server.slice(0, 40) : null
      useDb()
        .insert(schema.audit)
        .values({
          userId: null,
          action: 'discord.refused',
          target: server,
          detail: viaDiscord(discordActor(interaction), { command: command.name }),
        })
        .run()
    },
    followUp: postDiscordFollowUp,
  })
})
