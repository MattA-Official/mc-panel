import { can as allows, type Permission } from '#shared/permissions'

/**
 * Whether the signed-in person may do something, for hiding what they can't use. The
 * server checks every request anyway; this only keeps the UI honest.
 */
export function useCan() {
  const { state } = useAuthState()
  return (permission: Permission, server?: string) =>
    state.value?.access ? allows(state.value.access, permission, server) : false
}
