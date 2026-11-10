import { z } from 'zod'
import type { CleanUp } from '../../../../shared/disk'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('journal'), maxMb: z.number().int().min(16).max(100_000) }),
  z.object({ action: z.literal('apt') }),
  z.object({ action: z.literal('releases') }),
])

/**
 * Frees space in one of the fixed ways the agent offers, then re-measures the machine.
 * Needs a recent passkey check, and is recorded in Activity with what it freed.
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.updates')
  const { user } = await requireElevated(event)
  const body = await readValidatedBody(event, Body.parse)
  let freedBytes: number
  let removed: string[] | undefined
  try {
    if (body.action === 'journal') {
      ;({ freedBytes } = await agent('disk.vacuum-journal', { maxMb: body.maxMb }, LONG))
    } else if (body.action === 'apt') {
      ;({ freedBytes } = await agent('disk.clean-apt', {}, LONG))
    } else {
      ;({ freedBytes, removed } = await agent('disk.prune-flytower', {}, LONG))
    }
  } catch (err) {
    throw createError({ statusCode: 502, statusMessage: (err as Error).message })
  }
  const action: CleanUp = body.action
  audit(user.id, 'disk.clean', null, {
    action,
    freedBytes,
    ...(body.action === 'journal' ? { maxMb: body.maxMb } : {}),
    ...(removed ? { removed } : {}),
  })
  void useDiskUsage().refresh('*')
  return { freedBytes, removed: removed ?? [] }
})

const LONG = { timeoutMs: 5 * 60_000 }
