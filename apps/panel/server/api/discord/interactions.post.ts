import { answer, type Interaction } from '../../discord/interactions'
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
  return answer(interaction)
})
