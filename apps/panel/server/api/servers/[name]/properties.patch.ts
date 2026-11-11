import { z } from 'zod'
import { schema } from '../../../db'
import { refuseManagedEdits, withoutSecrets } from '../../../properties'
import { BAD_LEVEL_NAME, isSafeLevelName } from '../../../../shared/spec'

const Params = z.object({ name: z.string().max(40) })
const Body = z.object({
  values: z.record(
    z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}$/, 'Property names are letters, numbers, dots and dashes.'),
    z.string().max(2000),
  ),
})

/** Edits server.properties. Minecraft reads it at start-up, so changes need a restart. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'settings.edit')
  const { user } = await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const { values } = await readValidatedBody(event, Body.parse)
  findServer(name)
  const refused = refuseManagedEdits(Object.keys(values))
  if (refused) throw createError({ statusCode: 400, statusMessage: refused })
  if (values['level-name'] !== undefined && !isSafeLevelName(values['level-name'])) {
    throw createError({ statusCode: 400, statusMessage: BAD_LEVEL_NAME })
  }
  await writeProperties(name, values)
  useDb()
    .insert(schema.audit)
    .values({
      userId: user.id,
      action: 'server.properties',
      target: name,
      detail: { keys: Object.keys(values) },
    })
    .run()
  return { values: withoutSecrets(await readProperties(name)) }
})
