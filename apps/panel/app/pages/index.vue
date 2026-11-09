<script setup lang="ts">
useHead({ title: 'Servers' })
const { data: health } = await useFetch('/api/health')
</script>

<template>
  <UDashboardPanel id="servers">
    <template #header>
      <UDashboardNavbar title="Servers">
        <template #right>
          <UButton icon="i-lucide-plus" label="New server" disabled />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <UEmpty
        icon="i-lucide-drama"
        title="Nothing on stage yet."
        description="Create your first server to get started."
      />
      <p v-if="health && !health.agent.ok" class="mt-6 text-sm text-muted">
        The system helper isn't running, so servers can't be started yet.
      </p>
    </template>
  </UDashboardPanel>
</template>
