import { z } from 'zod'
import { needsSetup, verifyToken } from '../../auth/setup-token'

const Body = z.object({ token: z.string().min(1).max(200) })

const messages = {
  wrong: 'That setup token is not right. Check it and try again.',
  locked: 'Too many wrong tokens. Re-run the installer to get a new one.',
  expired: 'This setup token has expired. Re-run the installer to get a new one.',
  used: 'Setup is already done. Sign in instead.',
  missing: 'No setup token is waiting. Re-run the installer to get one.',
} as const

export default defineEventHandler(async (event) => {
  limit(event, 'setup', 5)
  const db = useDb()
  if (!needsSetup(db)) throw createError({ statusCode: 409, statusMessage: messages.used })
  const { token } = await readValidatedBody(event, Body.parse)
  const result = await verifyToken(db, token)
  if (result !== 'ok') throw createError({ statusCode: 400, statusMessage: messages[result] })
  await setUserSession(event, { setupVerified: true })
  return { ok: true }
})
