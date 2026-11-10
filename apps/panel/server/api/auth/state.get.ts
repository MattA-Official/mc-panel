import { loadAccess } from '../../auth/access'
import { needsSetup } from '../../auth/setup-token'

/** What the browser needs to decide where to send the user. */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const access = session.user ? loadAccess(useDb(), session.user.id) : null
  return {
    needsSetup: needsSetup(useDb()),
    setupVerified: Boolean(session.setupVerified),
    // A person removed since signing in counts as signed out.
    user: access ? session.user! : null,
    /** What this person can do; the UI hides the rest. */
    access,
    mustEnrolPasskey: Boolean(session.mustEnrolPasskey),
    elevated: Boolean(session.elevatedUntil && session.elevatedUntil > Date.now()),
  }
})
