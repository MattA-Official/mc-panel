import { z } from 'zod'
import { PAST_WORLD_NAME_MAX } from '../../../../backups/exports'

const Seed = z.union([
  z.object({ keep: z.literal(true) }),
  z.object({ random: z.literal(true) }),
  z.object({ seed: z.string().min(1).max(64) }),
])
const Options = z.object({
  /** Keep the old world as a past world with this name. */
  pastWorld: z.string().max(PAST_WORLD_NAME_MAX).nullish(),
  /** Keep the backup taken first forever. */
  keepBackup: z.boolean().optional(),
})

/** Resets the world after a backup. Needs a recent passkey check. */
export default defineEventHandler(async (event) => {
  await requireElevated(event)
  const { user, name, world } = await worldContext(event)
  const { seed, opts } = await readValidatedBody(event, (b) => ({
    seed: Seed.parse(b),
    opts: Options.parse(b),
  }))
  const { jobId } = await worldHttp(() => world.reset(name, seed, opts))
  audit(user.id, 'world.reset', name, { ...seed, ...opts, jobId })
  useStatus().poke()
  return { jobId }
})
