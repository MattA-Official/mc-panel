import { z } from 'zod'

const Params = z.object({ slot: z.enum(['logo', 'favicon']) })

/** Uploads a logo or favicon: the raw SVG or PNG as the body, with its content type. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.manage')
  const { user } = await requireElevated(event)
  const { slot } = await getValidatedRouterParams(event, Params.parse)
  const length = Number(getRequestHeader(event, 'content-length') ?? 0)
  if (length > 1024 * 1024)
    throw createError({ statusCode: 413, statusMessage: 'That file is over 1 MB.' })
  const raw = (await readRawBody(event, false)) ?? Buffer.alloc(0)
  const type = getRequestHeader(event, 'content-type') ?? ''
  const img = brandingHttp(() => useBranding().setImage(slot, type, new Uint8Array(raw)))
  audit(user.id, `branding.${slot}`, null, { type: img.type, hash: img.hash })
  return useBranding().public()
})
