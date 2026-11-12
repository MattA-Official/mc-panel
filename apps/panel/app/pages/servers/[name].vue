<script setup lang="ts">
import type { Permission } from '#shared/permissions'
import { serverUpdateCount } from '#shared/updates'

const route = useRoute()
const name = computed(() => String(route.params.name))
const { data: server, error, refresh } = await useFetch<Server>(() => `/api/servers/${name.value}`)
useHead({ title: () => server.value?.displayName ?? 'Server' })

const live = useLiveStatuses()
const status = computed<ServiceState>(
  () => live.value[name.value] ?? server.value?.status ?? 'unknown',
)
const liveHealth = useLiveHealth()
const health = computed<Health>(
  () => liveHealth.value[name.value] ?? server.value?.health ?? { condition: null, crash: null },
)
const running = computed(() => status.value === 'active' || status.value === 'activating')
const busy = ref<null | 'start' | 'stop' | 'restart'>(null)
const confirming = ref<null | 'stop' | 'restart'>(null)

const can = useCan()
const canPower = computed(() => can('server.power', name.value))

/**
 * What each view needs for changes, and what to say when that's missing. Keyed by the path
 * after the server's name (`content`, `settings/yaml`), most specific first.
 */
// Settings and World say this per section, so they aren't here.
const WRITE_NEEDS: [string, { permission: Permission; text: string }][] = [
  [
    'settings/yaml',
    { permission: 'spec.edit', text: 'You can read the YAML but not apply changes.' },
  ],
  [
    'content',
    { permission: 'content.manage', text: 'You can see what is installed but not change it.' },
  ],
  [
    'players',
    { permission: 'players.manage', text: 'You can see who plays here but not manage them.' },
  ],
]
const readOnly = computed(() => {
  const view = route.path.split('/').slice(3).join('/')
  // The Stats view on Players is only for reading, so it needs nothing more.
  if (view === 'players' && route.query.view === 'stats') return null
  const need = WRITE_NEEDS.find(([key]) => view === key || view.startsWith(`${key}/`))?.[1]
  return need && !can(need.permission, name.value) ? need.text : null
})

const toast = useToast()
async function act(action: 'start' | 'stop' | 'restart') {
  confirming.value = null
  busy.value = action
  try {
    await $fetch(`/api/servers/${name.value}/${action}`, { method: 'POST' })
  } catch (err) {
    toast.add({
      title: `Couldn't ${action} the server`,
      description: (err as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error',
    })
  } finally {
    busy.value = null
  }
}

provideServerContext({ server, status, health, refresh })

const liveUpdates = useLiveUpdates()
const contentUpdates = computed(() => serverUpdateCount(liveUpdates.value, name.value))

const tabs = computed<
  {
    label: string
    icon: string
    to: string
    exact?: boolean
    badge?: { label: string; color: 'info'; variant: 'subtle'; 'aria-label'?: string }
  }[]
>(() => [
  ...(can('console.read', name.value)
    ? [{ label: 'Console', icon: 'i-lucide-terminal', to: `/servers/${name.value}`, exact: true }]
    : []),
  { label: 'Players', icon: 'i-lucide-users', to: `/servers/${name.value}/players` },
  {
    label: 'Content',
    icon: 'i-lucide-package',
    to: `/servers/${name.value}/content`,
    // How many installed items have an update, from the background check.
    ...(contentUpdates.value
      ? {
          badge: {
            label: String(contentUpdates.value),
            color: 'info' as const,
            variant: 'subtle' as const,
            'aria-label': `${contentUpdates.value} update${contentUpdates.value === 1 ? '' : 's'} available`,
          },
        }
      : {}),
  },
  { label: 'World', icon: 'i-lucide-globe', to: `/servers/${name.value}/world` },
  ...(can('files.read', name.value)
    ? [{ label: 'Files', icon: 'i-lucide-folder-open', to: `/servers/${name.value}/files` }]
    : []),
  { label: 'Settings', icon: 'i-lucide-sliders-horizontal', to: `/servers/${name.value}/settings` },
])

/**
 * The Logs pop-up, open while the address has `?logs` (a file name, `crashes`, or empty for
 * the newest log), so Back closes it and links can open it on the right thing.
 */
const router = useRouter()
const logsOpen = computed(() => route.query.logs !== undefined && can('console.read', name.value))
const logFile = computed({
  get: () => String(route.query.logs ?? ''),
  set: (logs) => {
    // Closing empties the choice; that mustn't open the pop-up again.
    if (route.query.logs !== undefined) router.replace({ query: { ...route.query, logs } })
  },
})
function closeLogs() {
  const query = { ...route.query }
  delete query.logs
  router.replace({ query })
}

/** The tab being shown, for the phone-sized tab menu. */
const currentTab = computed(
  () =>
    [...tabs.value]
      .reverse()
      .find((t) => (t.exact ? route.path === t.to : route.path.startsWith(t.to))) ?? tabs.value[0]!,
)
const tabMenu = computed(() => [
  tabs.value.map((t) => ({ ...t, type: 'link' as const, active: t.to === currentTab.value.to })),
])

/** On phones, Start, Restart and Stop live in one labelled menu instead of bare icons. */
const powerMenu = computed(() => [
  running.value
    ? [
        {
          label: 'Restart',
          icon: 'i-lucide-rotate-cw',
          onSelect: () => (confirming.value = 'restart'),
        },
        {
          label: 'Stop',
          icon: 'i-lucide-square',
          color: 'error' as const,
          onSelect: () => (confirming.value = 'stop'),
        },
      ]
    : [{ label: 'Start', icon: 'i-lucide-play', onSelect: () => act('start') }],
])
</script>

<template>
  <UDashboardPanel id="server">
    <template #header>
      <UDashboardNavbar :ui="{ left: 'min-w-0', title: 'min-w-0' }">
        <template #title>
          <span class="truncate">{{ server?.displayName ?? name }}</span>
        </template>
        <template #leading>
          <UButton icon="i-lucide-arrow-left" variant="ghost" color="neutral" to="/" />
        </template>
        <template #trailing>
          <span v-if="server" class="hidden sm:contents"
            ><StatusBadge :status="status" :condition="health.condition"
          /></span>
          <span v-if="server" class="hidden min-w-0 text-sm text-muted md:block">
            <CopyAddress :server="server" />
          </span>
        </template>
        <template #right>
          <HelpButton />
          <template v-if="server && canPower">
            <UDropdownMenu :items="powerMenu" :content="{ align: 'end' }" class="sm:hidden">
              <UButton
                label="Power"
                icon="i-lucide-power"
                trailing-icon="i-lucide-chevron-down"
                color="neutral"
                variant="outline"
                :loading="!!busy"
              />
            </UDropdownMenu>
            <UButton
              v-if="!running"
              class="hidden sm:inline-flex"
              label="Start"
              icon="i-lucide-play"
              :loading="busy === 'start'"
              :disabled="!!busy"
              @click="act('start')"
            />
            <template v-else>
              <UButton
                class="hidden sm:inline-flex"
                label="Restart"
                icon="i-lucide-rotate-cw"
                color="neutral"
                variant="outline"
                :loading="busy === 'restart'"
                :disabled="!!busy"
                @click="confirming = 'restart'"
              />
              <UButton
                class="hidden sm:inline-flex"
                label="Stop"
                icon="i-lucide-square"
                color="error"
                variant="soft"
                :loading="busy === 'stop'"
                :disabled="!!busy"
                @click="confirming = 'stop'"
              />
            </template>
          </template>
        </template>
      </UDashboardNavbar>
      <UDashboardToolbar v-if="server">
        <UNavigationMenu :items="tabs" highlight class="-mx-1 hidden flex-1 xl:flex" />
        <UDropdownMenu :items="tabMenu" :content="{ align: 'start' }" class="xl:hidden">
          <UButton
            :label="currentTab.label"
            :icon="currentTab.icon"
            trailing-icon="i-lucide-chevron-down"
            color="neutral"
            variant="ghost"
            class="-mx-2.5 my-1"
            data-e2e="tab-menu"
          />
        </UDropdownMenu>
        <span class="ml-auto flex items-center sm:hidden"
          ><StatusBadge :status="status" :condition="health.condition"
        /></span>
      </UDashboardToolbar>
    </template>

    <template #body>
      <UEmpty
        v-if="error"
        icon="i-lucide-search-x"
        :title="`No server called ${name}`"
        description="It may have been deleted."
        :actions="[{ label: 'All servers', to: '/' }]"
      />
      <template v-else-if="server">
        <UAlert
          v-if="readOnly"
          class="mb-4 shrink-0"
          color="neutral"
          variant="subtle"
          icon="i-lucide-eye"
          title="View only"
          :description="readOnly"
          data-e2e="read-only"
        />
        <!-- A disabled fieldset disables every button and field inside, so nothing here can be
             changed without the permission. The server checks every request anyway. -->
        <fieldset :disabled="!!readOnly" class="contents">
          <NuxtPage />
        </fieldset>
      </template>
      <UModal
        v-if="server"
        :open="logsOpen"
        title="Logs"
        :description="server.displayName"
        :ui="{
          content:
            'h-dvh max-h-dvh max-w-none rounded-none sm:h-[92dvh] sm:max-h-[92dvh] sm:max-w-[min(96vw,100rem)] sm:rounded-lg',
          body: 'flex min-h-0 flex-1 flex-col sm:p-4',
        }"
        @update:open="(v) => !v && closeLogs()"
      >
        <template #body>
          <ServerLogs v-model="logFile" />
        </template>
      </UModal>
      <UModal
        :open="!!confirming"
        :title="confirming === 'stop' ? 'Stop the server?' : 'Restart the server?'"
        description="Anyone playing will be disconnected. The world is saved first."
        @update:open="(v) => !v && (confirming = null)"
      >
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="confirming = null" />
            <UButton
              :label="confirming === 'stop' ? 'Stop' : 'Restart'"
              :color="confirming === 'stop' ? 'error' : 'primary'"
              @click="act(confirming!)"
            />
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
