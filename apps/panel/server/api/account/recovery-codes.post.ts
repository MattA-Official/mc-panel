import { issueCodes } from '../../auth/recovery'

/** A fresh set of recovery codes, shown once; the old ones stop working. */
export default defineEventHandler(async (event) => {
  const { user } = await requireElevated(event)
  const codes = await issueCodes(useDb(), user.id)
  audit(user.id, 'recovery.reissued', null)
  return { codes }
})
