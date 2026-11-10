import { z } from 'zod'

const Body = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/),
  /** Go back to a release already installed, rather than download one. */
  rollback: z.boolean().default(false),
})

/**
 * Installs a release, or goes back to an installed one. The panel restarts partway, so
 * the page follows along by polling /api/health. Needs a recent passkey check.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.updates')
  const { user } = await requireElevated(event)
  const { version, rollback } = await readValidatedBody(event, Body.parse)
  try {
    if (rollback) await agent('update.rollback', { version }, { timeoutMs: 30_000 })
    else await agent('update.install', { version }, { timeoutMs: 10 * 60_000 })
  } catch (err) {
    throw createError({ statusCode: 502, statusMessage: (err as Error).message })
  }
  audit(user.id, rollback ? 'update.rollback' : 'update.install', null, { version })
  return { started: true }
})
