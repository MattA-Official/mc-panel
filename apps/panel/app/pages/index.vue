<script setup lang="ts">
import { serverUpdateCount } from '#shared/updates'

useHead({ title: 'Servers' })
const { data: health } = await useFetch('/api/health')
const { data: servers } = await useFetch<Server[]>('/api/servers', { default: () => [] })
const live = useLiveStatuses()
const statusOf = (s: Server) => live.value[s.name] ?? s.status
const liveHealth = useLiveHealth()
const healthOf = (s: Server) => liveHealth.value[s.name] ?? s.health
const updates = useLiveUpdates()
const updatesOf = (s: Server) => serverUpdateCount(updates.value, s.name)
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const can = useCan()
</script>

<template>
  <UDashboardPanel id="servers">
    <template #header>
      <UDashboardNavbar title="Servers">
        <template v-if="can('servers.create')" #right>
          <UButton icon="i-lucide-plus" label="New server" to="/servers/new" />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <UAlert
        v-if="health && !health.agent.ok"
        class="mb-6"
        color="warning"
        variant="subtle"
        icon="i-lucide-plug-zap"
        title="The system helper isn't running"
        description="Servers can't be started, stopped or created until it's back. Restarting the machine usually fixes it."
      />
      <UEmpty
        v-if="servers.length === 0"
        icon="i-lucide-drama"
        title="Nothing on stage yet."
        description="Create your first server to get started."
      />
      <template v-else>
        <MemoryBudget class="mb-6 max-w-md" />
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <NuxtLink
            v-for="s in servers"
            :key="s.name"
            :to="`/servers/${s.name}`"
            class="group min-w-0 rounded-lg border border-default bg-elevated/40 p-4 transition-colors hover:border-primary/60"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h2 class="truncate font-display text-xl tracking-wide uppercase">
                  {{ s.displayName }}
                </h2>
                <p class="text-xs text-muted"><CopyAddress :server="s" /></p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <UTooltip v-if="healthOf(s).crash" :text="`Crashed ${when(healthOf(s).crash!.at)}`">
                  <span
                    class="size-2 rounded-full bg-error"
                    role="img"
                    :aria-label="`Crashed ${when(healthOf(s).crash!.at)}`"
                    data-e2e="crash-dot"
                  />
                </UTooltip>
                <UTooltip
                  v-if="updatesOf(s)"
                  :text="`${updatesOf(s)} update${updatesOf(s) === 1 ? '' : 's'} for installed content`"
                >
                  <UBadge
                    color="info"
                    variant="subtle"
                    icon="i-lucide-arrow-up-circle"
                    :label="String(updatesOf(s))"
                    :aria-label="`${updatesOf(s)} update${updatesOf(s) === 1 ? '' : 's'} available`"
                    data-e2e="update-badge"
                  />
                </UTooltip>
                <StatusBadge :status="statusOf(s)" :condition="healthOf(s).condition" />
              </div>
            </div>
            <dl class="mt-4 grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt class="text-xs text-muted">Version</dt>
                <dd>{{ loaderLabel(s) }}</dd>
              </div>
              <div>
                <dt class="text-xs text-muted">Port</dt>
                <dd class="font-mono">{{ s.port }}</dd>
              </div>
              <div>
                <dt class="text-xs text-muted">Memory</dt>
                <dd>{{ formatMemory(s.memoryMb) }}</dd>
              </div>
            </dl>
          </NuxtLink>
        </div>
      </template>
    </template>
  </UDashboardPanel>
</template>
