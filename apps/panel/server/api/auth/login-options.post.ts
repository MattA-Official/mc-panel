import { authenticationOptions } from '../../auth/passkeys'

export default defineEventHandler((event) => authenticationOptions(relyingParty(event), 'login'))
