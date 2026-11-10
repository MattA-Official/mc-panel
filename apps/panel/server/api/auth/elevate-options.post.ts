import { authenticationOptions } from '../../auth/passkeys'

export default defineEventHandler(async (event) => {
  await requireSignedIn(event)
  return authenticationOptions(relyingParty(event), 'elevate')
})
