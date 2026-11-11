import { loadAccess } from '../auth/access'
import { isFromThisBox } from '../utils/this-box'

/**
 * Liveness for the installer, the updater, the release smoke test and the System page. Never
 * throws. Versions only go to signed-in people and to the box itself, so strangers can't use
 * them to pick out installs that are behind on fixes.
 */
export default defineEventHandler(async (event) => {
  if (!fromThisBox(event) && !(await signedIn(event)))
    return { ok: true as const, version: null, agent: null }
  const { version } = useRuntimeConfig()
  try {
    const ping = await agent('ping', {}, { timeoutMs: 3_000 })
    return { ok: true as const, version, agent: { ok: true as const, version: ping.agentVersion } }
  } catch {
    return { ok: true as const, version, agent: { ok: false as const, version: null } }
  }
})

/** A request straight to the panel's port from this machine, not through the proxy. */
function fromThisBox(event: Parameters<typeof getRequestIP>[0]) {
  return isFromThisBox({
    forwardedFor: getRequestHeader(event, 'x-forwarded-for'),
    ip: getRequestIP(event),
    listenHost: process.env.NITRO_HOST || process.env.HOST,
  })
}

async function signedIn(event: Parameters<typeof getRequestIP>[0]) {
  const session = await getUserSession(event)
  return !!session.user && !!loadAccess(useDb(), session.user.id, session.sessionVersion)
}
