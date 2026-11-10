import { offsiteHttp, TargetBody } from '../../../backups/offsite-http'

/** Checks a target's settings without saving them. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.integrations')
  const body = await readValidatedBody(event, TargetBody.parse)
  await offsiteHttp(() => useOffsite().test(body))
  return { ok: true }
})
