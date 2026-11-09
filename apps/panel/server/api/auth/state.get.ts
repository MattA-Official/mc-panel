import { needsSetup } from '../../auth/setup-token'

/** What the browser needs to decide where to send the user. */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  return {
    needsSetup: needsSetup(useDb()),
    setupVerified: Boolean(session.setupVerified),
    user: session.user ?? null,
    mustEnrolPasskey: Boolean(session.mustEnrolPasskey),
    elevated: Boolean(session.elevatedUntil && session.elevatedUntil > Date.now()),
  }
})
