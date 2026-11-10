<script setup lang="ts">
/** Who can sign in (People) and what each role allows (Roles). */
useHead({ title: 'Access' })
const tabs = [
  { label: 'People', icon: 'i-lucide-users', to: '/access', exact: true },
  { label: 'Roles', icon: 'i-lucide-shield', to: '/access/roles' },
]
</script>

<template>
  <UDashboardPanel id="access">
    <template #header>
      <UDashboardNavbar title="Access">
        <template #right><HelpButton /></template>
      </UDashboardNavbar>
      <UDashboardToolbar>
        <UNavigationMenu :items="tabs" highlight class="-mx-1 flex-1" />
      </UDashboardToolbar>
    </template>
    <template #body>
      <div class="mx-auto w-full max-w-5xl space-y-6">
        <NuxtPage />
      </div>
    </template>
  </UDashboardPanel>
</template>
