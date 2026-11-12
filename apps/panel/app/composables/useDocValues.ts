import { docValue, type DocValueId } from '@flytower/docs-layer/values'
import type { Server } from './useServers'

/**
 * Reads Help's live values (#270), such as `:value{of="server.address"}`, for the server
 * whose page you're on, or your only server. Null when it can't tell, and the docs then show
 * words instead.
 */
export function useDocValues() {
  const route = useRouter().currentRoute
  const url = useRequestURL()
  const { data: servers } = useFetch<Server[]>('/api/servers', {
    key: 'doc-values-servers',
    default: () => [],
  })

  const server = computed(() => {
    const list = servers.value ?? []
    const here =
      route.value.path.startsWith('/servers/') && route.value.params.name
        ? String(route.value.params.name)
        : null
    if (here) return list.find((s) => s.name === here) ?? null
    return list.length === 1 ? list[0]! : null
  })

  return (of: string): string | null => {
    if (!docValue(of)) return null
    const s = server.value
    switch (of as DocValueId) {
      case 'server.name':
        return s?.displayName ?? null
      case 'server.address':
        return s ? connectAddress(s, url.hostname) : null
      case 'server.version':
        return s?.mcVersion ?? null
      case 'panel.address':
        return url.origin
    }
  }
}
