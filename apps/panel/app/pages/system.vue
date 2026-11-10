<script setup lang="ts">
import { systemUpdateCount } from '#shared/updates'

const updates = useLiveUpdates()
/** System is split into sections, so health, updates, storage, alerts, branding and sign-in each get a page. */
const sections = computed(() => [
  { label: 'Overview', icon: 'i-lucide-gauge', to: '/system', exact: true },
  {
    label: 'Updates',
    icon: 'i-lucide-arrow-up-circle',
    to: '/system/updates',
    ...(systemUpdateCount(updates.value)
      ? {
          badge: {
            label: String(systemUpdateCount(updates.value)),
            color: 'info' as const,
            variant: 'subtle' as const,
          },
        }
      : {}),
  },
  { label: 'Off-site storage', icon: 'i-lucide-cloud', to: '/system/storage' },
  { label: 'Notifications', icon: 'i-lucide-bell', to: '/system/notifications' },
  { label: 'Branding', icon: 'i-lucide-palette', to: '/system/branding' },
  { label: 'Account and security', icon: 'i-lucide-shield', to: '/system/account' },
])
const route = useRoute()
const current = computed(
  () =>
    [...sections.value]
      .reverse()
      .find((s) => (s.exact ? route.path === s.to : route.path.startsWith(s.to))) ??
    sections.value[0]!,
)
const menu = computed(() => [
  sections.value.map((s) => ({ ...s, type: 'link' as const, active: s.to === current.value.to })),
])
</script>

<template>
  <UDashboardPanel id="system">
    <template #header>
      <UDashboardNavbar title="System" />
      <UDashboardToolbar>
        <UNavigationMenu :items="sections" highlight class="-mx-1 hidden flex-1 lg:flex" />
        <UDropdownMenu :items="menu" :content="{ align: 'start' }" class="lg:hidden">
          <UButton
            :label="current.label"
            :icon="current.icon"
            trailing-icon="i-lucide-chevron-down"
            color="neutral"
            variant="ghost"
            class="-mx-2.5 my-1"
          />
        </UDropdownMenu>
      </UDashboardToolbar>
    </template>
    <template #body>
      <div class="mx-auto w-full max-w-5xl space-y-6">
        <NuxtPage />
      </div>
    </template>
  </UDashboardPanel>
</template>
