const PUBLIC = new Set(['/setup', '/login'])

/** Sends the browser to setup, sign-in or passkey enrolment as the session requires. */
export default defineNuxtRouteMiddleware(async (to) => {
  // Public status pages are for anyone, signed in or not.
  if (to.path.startsWith('/s/')) return
  const { state, refresh } = useAuthState()
  const s = state.value ?? (await refresh())

  if (s.needsSetup) return to.path === '/setup' ? undefined : navigateTo('/setup')
  // Invite links are opened signed out; signed in, the page says to sign out first.
  if (to.path === '/join') return
  if (!s.user) {
    if (to.path === '/login') return
    // Remember where they were going, so signing in takes them there.
    const next = returnPath(to.fullPath)
    return navigateTo({ path: '/login', query: next === '/' ? {} : { next } })
  }
  if (s.mustEnrolPasskey) return to.path === '/enrol' ? undefined : navigateTo('/enrol')
  if (PUBLIC.has(to.path) || to.path === '/enrol') return navigateTo('/')
})
