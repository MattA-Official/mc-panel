import { offsiteHttp, TargetBody } from '../../../backups/offsite-http'

/** Adds a target after checking it works. Needs a fresh passkey check. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.integrations')
  const { user } = await requireElevated(event)
  const body = await readValidatedBody(event, TargetBody.parse)
  const added = await offsiteHttp(() => useOffsite().addTarget(body))
  audit(user.id, 'backup.target.add', null, {
    name: body.name,
    endpoint: body.endpoint,
    bucket: body.bucket,
  })
  return added
})
