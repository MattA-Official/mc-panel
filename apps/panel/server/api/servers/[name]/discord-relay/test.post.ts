import { z } from 'zod'
import { DeliveryError } from '../../../../notify/types'

const Params = z.object({ name: z.string().max(40) })
const Body = z.object({ url: z.string().trim().url().max(500).optional() })

/** Sends one test message to the webhook given, or the saved one, and says whether it arrived. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.configure')
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const { url } = await readValidatedBody(event, Body.parse)
  const server = findServer(name)
  limit(event, 'discord-relay-test', 10, 60_000)
  try {
    await useChatRelay().test(
      await relayTestUrl(name, url),
      `Flytower will post ${server.displayName}'s chat here.`,
    )
  } catch (err) {
    if (err instanceof DeliveryError) {
      throw createError({ statusCode: 400, statusMessage: err.message })
    }
    throw err
  }
  return { ok: true }
})
