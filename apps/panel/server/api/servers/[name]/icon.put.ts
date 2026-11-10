import { cleanIcon, ICON_FILE, IconError, MAX_ICON_BYTES } from '../../../icon'
import { writeAtomic } from '../../../files'
import { schema } from '../../../db'

/** Sets the server's icon. The body is a 64×64 PNG, cropped and scaled in the browser. */
export default defineEventHandler(async (event) => {
  const ctx = await fileContext(event)
  const length = Number(getRequestHeader(event, 'content-length') ?? 0)
  if (length > MAX_ICON_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'The icon is too big.' })
  }
  const body = await readRawBody(event, false)
  if (!body?.length) throw createError({ statusCode: 400, statusMessage: 'No icon sent.' })
  let icon: Uint8Array
  try {
    icon = cleanIcon(new Uint8Array(body))
  } catch (err) {
    if (err instanceof IconError) throw createError({ statusCode: 400, statusMessage: err.message })
    throw err
  }
  await fileAction(ctx, null, {}, () => writeAtomic(ctx.root, ICON_FILE, new Response(icon)))
  useDb()
    .insert(schema.audit)
    .values({ userId: ctx.user.id, action: 'server.icon', target: ctx.name, detail: {} })
    .run()
  return { icon: iconUrl(ctx.name) }
})
