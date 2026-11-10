import { loadAccess } from '../auth/access'
import { needsSetup } from '../auth/setup-token'

const ALWAYS_OPEN = new Set([
  '/api/health',
  '/api/auth/state',
  '/api/auth/logout',
  // The sign-in, setup and status pages show the install's name and logo.
  '/api/branding',
])
/** Public status pages; each route checks that the server's page is on. */
const PUBLIC_PREFIX = '/api/public/'
const SETUP_ROUTES = new Set([
  '/api/setup/token',
  '/api/passkeys/register-options',
  '/api/passkeys/register',
])
const SIGN_IN_ROUTES = new Set(['/api/auth/login-options', '/api/auth/login', '/api/auth/recovery'])
const ENROL_ROUTES = new Set(['/api/passkeys/register-options', '/api/passkeys/register'])

/**
 * Closes the API by default. Before setup only the setup routes answer; after a recovery-code
 * sign-in only passkey enrolment does; everything else needs a session. Routes still check
 * what they need themselves; this is the backstop for any route that forgets.
 */
export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/') || path.startsWith('/api/_') || ALWAYS_OPEN.has(path)) return
  if (path.startsWith(PUBLIC_PREFIX)) return

  if (needsSetup(useDb())) {
    if (SETUP_ROUTES.has(path)) return
    throw createError({ statusCode: 403, statusMessage: 'Finish setup first.' })
  }
  if (SIGN_IN_ROUTES.has(path)) return

  const session = await getUserSession(event)
  if (!session.user) throw createError({ statusCode: 401, statusMessage: 'Sign in first.' })
  // Someone removed since signing in is signed out at once, whatever their cookie says.
  const access = loadAccess(useDb(), session.user.id)
  if (!access) {
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'Sign in first.' })
  }
  event.context.access = access
  if (session.mustEnrolPasskey && !ENROL_ROUTES.has(path)) {
    throw createError({ statusCode: 403, statusMessage: 'Add a new passkey first.' })
  }
})
