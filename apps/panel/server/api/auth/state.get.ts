import { eq } from 'drizzle-orm'
import { schema } from '../../db'
import { loadAccess } from '../../auth/access'
import { needsSetup } from '../../auth/setup-token'

/** What the browser needs to decide where to send the user. */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const access = session.user ? loadAccess(useDb(), session.user.id, session.sessionVersion) : null
  // The name comes from the database, so a rename shows in every open session.
  const person = access
    ? useDb().select().from(schema.users).where(eq(schema.users.id, session.user!.id)).get()
    : undefined
  return {
    needsSetup: needsSetup(useDb()),
    setupVerified: Boolean(session.setupVerified),
    // A person removed since signing in counts as signed out.
    user: access && person ? { id: person.id, name: person.name } : null,
    /** Light, dark or follow the device, saved for the person. */
    theme: person?.theme ?? 'system',
    /** What this person can do; the UI hides the rest. */
    access,
    mustEnrolPasskey: Boolean(session.mustEnrolPasskey),
    elevated: Boolean(session.elevatedUntil && session.elevatedUntil > Date.now()),
  }
})
