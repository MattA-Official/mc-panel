<script setup lang="ts">
useHead({ title: 'System' })
const { data: health, refresh } = await useFetch('/api/health')
const updates = useLiveUpdates()
const can = useCan()
const flytower = computed(() => updates.value?.flytower?.summary?.latest ?? null)
</script>

<template>
  <UAlert
    v-if="flytower && can('system.updates')"
    color="info"
    variant="subtle"
    icon="i-lucide-arrow-up-circle"
    :title="`Flytower ${flytower.version}${flytower.prerelease ? ' (beta)' : ''} is available`"
    description="Updating takes a minute and keeps your servers running."
    :actions="[{ label: 'See what\'s new', variant: 'outline', to: '/system/updates' }]"
    data-e2e="flytower-update-banner"
  />
  <UCard v-if="health">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt class="text-muted">Flytower</dt>
        <dd class="font-mono">{{ health.version }}</dd>
        <dt class="text-muted">System helper</dt>
        <dd>
          <UBadge
            :color="health.agent.ok ? 'success' : 'error'"
            variant="subtle"
            :label="health.agent.ok ? `Running, ${health.agent.version}` : 'Not reachable'"
          />
        </dd>
      </dl>
      <UButton
        class="self-start sm:self-center"
        color="neutral"
        variant="outline"
        icon="i-lucide-refresh-cw"
        label="Check again"
        @click="refresh()"
      />
    </div>
  </UCard>
  <UCard>
    <template #header><h2 class="text-base font-semibold">This machine</h2></template>
    <MetricsHistory />
  </UCard>
  <UCard>
    <MemoryBudget detailed />
  </UCard>
  <UCard>
    <DiskUse />
  </UCard>
</template>
