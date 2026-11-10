/**
 * Links for the command palette: servers (with their tabs and actions) and the panel's
 * pages, filtered by what the signed-in person may do.
 */
export function usePaletteLinks(navigation: Ref<{ label: string; icon: string; to: string }[]>) {
  const route = useRoute()
  const can = useCan()
  const { data: servers, refresh } = useFetch<Server[]>('/api/servers', {
    key: 'palette-servers',
    default: () => [],
    server: false,
  })
  const { data: health } = useFetch('/api/health', { key: 'palette-health', server: false })
  const actionsFor = useServerActions(() => health.value?.agent.ok ?? true)

  const current = computed(() =>
    route.path.startsWith('/servers/') ? String(route.params.name ?? '') || null : null,
  )

  // Servers opened lately come first, remembered in this browser.
  const recent = ref<string[]>([])
  const KEY = 'flytower:recent-servers'
  function remember(name: string | null) {
    if (!name) return
    recent.value = rememberServer(recent.value, name)
    try {
      localStorage.setItem(KEY, JSON.stringify(recent.value))
    } catch {
      // Storage refused (private window): keep it for this page only.
    }
  }
  onMounted(() => {
    try {
      recent.value = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    } catch {
      recent.value = []
    }
    watch(current, remember, { immediate: true })
  })

  const pages = computed(() => [
    ...navigation.value.map((i) => ({ label: `Go to ${i.label}`, icon: i.icon, to: i.to })),
    ...(can('servers.create')
      ? [
          { label: 'New server', icon: 'i-lucide-plus', to: '/servers/new' },
          { label: 'Import a server', icon: 'i-lucide-import', to: '/servers/import' },
          { label: 'New server from YAML', icon: 'i-lucide-file-code', to: '/servers/from-yaml' },
        ]
      : []),
    ...(can('system.updates')
      ? [{ label: 'Updates', icon: 'i-lucide-download', to: '/system/updates' }]
      : []),
    ...(can('system.integrations')
      ? [
          { label: 'Off-site storage', icon: 'i-lucide-cloud', to: '/system/storage' },
          { label: 'Integrations', icon: 'i-lucide-blocks', to: '/system/integrations' },
        ]
      : []),
    ...(can('system.notifications')
      ? [{ label: 'Notifications', icon: 'i-lucide-bell', to: '/system/notifications' }]
      : []),
    { label: 'Your account', icon: 'i-lucide-user', to: '/account' },
  ])

  const ordered = computed(() =>
    orderServers(servers.value ?? [], current.value, recent.value).map((s) => ({
      server: s,
      link: serverLinks(s, actionsFor(s)),
    })),
  )
  /** Groups for servers, their tabs and actions, for what's typed so far. */
  const groups = (query: string) => serverGroups(ordered.value, current.value, query)

  return { pages, groups, refresh }
}
