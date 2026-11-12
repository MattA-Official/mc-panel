import { z } from 'zod'
import { can } from '../../../../shared/permissions'

const Body = z.union([
  z.object({ url: z.string().url().max(2000) }),
  z.object({ archive: z.string().max(200) }),
  z.object({ pastWorld: z.number().int().positive() }),
  z.object({}).strict(),
])

/** Fetches if needed, unpacks and inspects, as a job. */
export default defineEventHandler(async (event) => {
  const { access } = await requirePermission(event, 'servers.create')
  const { user, imports, id } = await importContext(event)
  const body = await readValidatedBody(event, Body.parse)
  // Only from a server this person can see, as the list of past worlds shows.
  if ('pastWorld' in body) {
    const world = useExports()
      .pastWorlds()
      .find((w) => w.id === body.pastWorld)
    if (!world || !can(access, 'server.view', world.server)) {
      throw createError({ statusCode: 404, statusMessage: 'No such past world.' })
    }
  }
  await importHttp(() => imports.get(id))
  const source =
    'url' in body
      ? { url: body.url }
      : 'archive' in body
        ? { archive: body.archive }
        : 'pastWorld' in body
          ? { pastWorld: body.pastWorld }
          : null
  const { jobId } = await importHttp(() => imports.unpack(id, source))
  audit(user.id, 'server.import.unpack', null, { id, ...body })
  return { jobId }
})
