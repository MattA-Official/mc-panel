import { z } from 'zod'
import { PAST_WORLD_NAME_MAX } from '../../../../../backups/exports'

const Body = z.object({ name: z.string().min(1).max(PAST_WORLD_NAME_MAX) })

/** Renames a past world. */
export default defineEventHandler(async (event) => {
  const { user, name: server } = await backupContext(event)
  const id = Number(getRouterParam(event, 'id'))
  const { name } = await readValidatedBody(event, Body.parse)
  const row = await backupHttp(() => useExports().renamePastWorld(server, id, name))
  audit(user.id, 'world.past.rename', server, { id, name: row.name })
  return { id: row.id, name: row.name }
})
