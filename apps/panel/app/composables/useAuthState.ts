import type { Access } from '#shared/permissions'

export interface AuthState {
  needsSetup: boolean
  setupVerified: boolean
  user: { id: number; name: string } | null
  /** What this person can do; null when signed out. */
  access: Access | null
  mustEnrolPasskey: boolean
  elevated: boolean
}

/** Shared auth state; `refresh()` after anything that changes the session. */
export function useAuthState() {
  const state = useState<AuthState | null>('auth-state', () => null)
  async function refresh() {
    state.value = await $fetch<AuthState>('/api/auth/state')
    return state.value
  }
  return { state, refresh }
}
