<script setup lang="ts">
useHead({ title: 'Servers' })
const { data: health } = await useFetch('/api/health')
const { data: servers } = await useFetch<Server[]>('/api/servers', { default: () => [] })
const live = useLiveStatuses()
const statusOf = (s: Server) => live.value[s.name] ?? s.status
</script>

<template>
  <UDashboardPanel id="servers">
    <template #header>
      <UDashboardNavbar title="Servers">
        <template #right>
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
      <div v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <NuxtLink
          v-for="s in servers"
          :key="s.name"
          :to="`/servers/${s.name}`"
          class="group rounded-lg border border-default bg-elevated/40 p-4 transition-colors hover:border-primary/60"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 class="truncate font-display text-xl tracking-wide uppercase">
                {{ s.displayName }}
              </h2>
              <p class="font-mono text-xs text-muted">{{ s.name }}</p>
            </div>
            <StatusBadge :status="statusOf(s)" />
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
  </UDashboardPanel>
</template>
