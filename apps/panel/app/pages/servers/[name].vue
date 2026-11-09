<script setup lang="ts">
const route = useRoute()
const name = computed(() => String(route.params.name))
const { data: server, error } = await useFetch<Server>(() => `/api/servers/${name.value}`)
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

const address = computed(() =>
  server.value
    ? server.value.port === 25565
      ? location.hostname
      : `${location.hostname}:${server.value.port}`
    : '',
)
const copied = ref(false)
async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
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
            icon="i-lucide-play"
            :loading="busy === 'start'"
            :disabled="!!busy"
            @click="act('start')"
          />
          <template v-else>
            <UButton
              label="Restart"
              icon="i-lucide-rotate-cw"
              color="neutral"
              variant="outline"
              :loading="busy === 'restart'"
              :disabled="!!busy"
              @click="confirming = 'restart'"
            />
            <UButton
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
      </UDashboardNavbar>
    </template>

    <template #body>
      <UEmpty
        v-if="error"
        icon="i-lucide-search-x"
        :title="`No server called ${name}`"
        description="It may have been deleted."
        :actions="[{ label: 'All servers', to: '/' }]"
      />
      <div v-else-if="server" class="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <ServerConsole
          :server="server.name"
          :running="status === 'active'"
          class="h-[calc(100dvh-10rem)] min-h-80"
        />

        <aside class="space-y-4">
          <div class="rounded-lg border border-default p-4">
            <p class="text-xs text-muted">Address</p>
            <div class="mt-1 flex items-center gap-2">
              <code class="truncate font-mono text-base">{{ address }}</code>
              <UButton
                :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                size="xs"
                variant="ghost"
                color="neutral"
                aria-label="Copy address"
                @click="copy(address)"
              />
            </div>
          </div>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-default p-4 text-sm">
            <div>
              <dt class="text-xs text-muted">Version</dt>
              <dd>{{ loaderLabel(server) }}</dd>
            </div>
            <div v-if="server.loaderVersion">
              <dt class="text-xs text-muted">Fabric loader</dt>
              <dd class="font-mono">{{ server.loaderVersion }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">Java</dt>
              <dd>Temurin {{ server.javaMajor }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">Memory</dt>
              <dd>{{ formatMemory(server.memoryMb) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">Short name</dt>
              <dd class="font-mono">{{ server.name }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted">Created</dt>
              <dd>
                {{
                  new Date(server.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })
                }}
              </dd>
            </div>
          </dl>
        </aside>
      </div>

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
