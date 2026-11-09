import { z } from 'zod'

const Body = z.union([
  z.object({ open: z.literal(false) }),
  z.object({ open: z.literal(true), minutes: z.number().int().min(1).max(1440).optional() }),
])

/** Opens or closes SSH. Needs a recent passkey check either way. */
export default defineEventHandler(async (event) => {
  const { user } = await requireElevated(event)
  const body = await readValidatedBody(event, Body.parse)
  try {
    const state = await agent('ssh.set', body, { timeoutMs: 30_000 })
    audit(user.id, body.open ? 'ssh.open' : 'ssh.close', null, body)
    return state
  } catch (err) {
    throw createError({ statusCode: 502, statusMessage: (err as Error).message })
  }
})
