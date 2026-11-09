import { authenticationOptions } from '../../auth/passkeys'

export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  return authenticationOptions(relyingParty(event), 'elevate')
})
