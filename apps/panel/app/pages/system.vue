<script setup lang="ts">
useHead({ title: 'System' })
const { data: health, refresh } = await useFetch('/api/health')
</script>

<template>
  <UDashboardPanel id="system">
    <template #header>
      <UDashboardNavbar title="System" />
    </template>
    <template #body>
      <div class="space-y-6">
        <UCard v-if="health" class="max-w-xl">
          <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt class="text-muted">Panel version</dt>
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
          <template #footer>
            <UButton
              variant="outline"
              icon="i-lucide-refresh-cw"
              label="Check again"
              @click="refresh()"
            />
          </template>
        </UCard>
        <UCard>
          <template #header><h2 class="font-medium">This machine</h2></template>
          <MetricsHistory />
        </UCard>
        <FlytowerUpdates />
        <OffsiteTargets />
        <UCard class="max-w-xl">
          <MemoryBudget detailed />
        </UCard>
        <AccountSecurity />
        <SshAccess />
      </div>
    </template>
  </UDashboardPanel>
</template>
