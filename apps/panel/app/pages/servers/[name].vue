<script setup lang="ts">
const route = useRoute()
const name = computed(() => String(route.params.name))
const { data: server, error, refresh } = await useFetch<Server>(() => `/api/servers/${name.value}`)
useHead({ title: () => server.value?.displayName ?? 'Server' })

const live = useLiveStatuses()
const status = computed<ServiceState>(
  () => live.value[name.value] ?? server.value?.status ?? 'unknown',
)
const running = computed(() => status.value === 'active' || status.value === 'activating')
const busy = ref<null | 'start' | 'stop' | 'restart'>(null)
const confirming = ref<null | 'stop' | 'restart'>(null)

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

provideServerContext({ server, status, refresh })

const tabs = computed(() => [
  { label: 'Console', icon: 'i-lucide-terminal', to: `/servers/${name.value}`, exact: true },
  { label: 'Logs', icon: 'i-lucide-scroll-text', to: `/servers/${name.value}/logs` },
  { label: 'Players', icon: 'i-lucide-users', to: `/servers/${name.value}/players` },
  { label: 'Backups', icon: 'i-lucide-archive', to: `/servers/${name.value}/backups` },
  { label: 'Files', icon: 'i-lucide-folder-open', to: `/servers/${name.value}/files` },
  { label: 'Settings', icon: 'i-lucide-sliders-horizontal', to: `/servers/${name.value}/settings` },
  { label: 'YAML', icon: 'i-lucide-file-code', to: `/servers/${name.value}/yaml` },
])
</script>

<template>
  <UDashboardPanel id="server">
    <template #header>
      <UDashboardNavbar :title="server?.displayName ?? name">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" variant="ghost" color="neutral" to="/" />
        </template>
        <template #trailing>
          <StatusBadge v-if="server" :status="status" />
        </template>
        <template v-if="server" #right>
          <UButton
            v-if="!running"
            label="Start"
            :ui="{ label: 'sr-only sm:not-sr-only' }"
            icon="i-lucide-play"
            :loading="busy === 'start'"
            :disabled="!!busy"
            @click="act('start')"
          />
          <template v-else>
            <UButton
              label="Restart"
              :ui="{ label: 'sr-only sm:not-sr-only' }"
              icon="i-lucide-rotate-cw"
              color="neutral"
              variant="outline"
              :loading="busy === 'restart'"
              :disabled="!!busy"
              @click="confirming = 'restart'"
            />
            <UButton
              label="Stop"
              :ui="{ label: 'sr-only sm:not-sr-only' }"
              icon="i-lucide-square"
              color="error"
              variant="soft"
              :loading="busy === 'stop'"
              :disabled="!!busy"
              @click="confirming = 'stop'"
            />
          </template>
        </template>
      </UDashboardNavbar>
      <UDashboardToolbar v-if="server">
        <UNavigationMenu :items="tabs" highlight class="-mx-1 flex-1" />
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
      <NuxtPage v-else-if="server" />
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
