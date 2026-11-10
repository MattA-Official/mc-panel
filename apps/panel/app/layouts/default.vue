<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { systemUpdateCount } from '#shared/updates'

const { productName } = useAppConfig()
const { state, refresh } = useAuthState()

async function signOut() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await refresh()
  await navigateTo('/login')
}

// Updates for Flytower or Java put a count on System; server ones show on each server.
const updates = useLiveUpdates()
const systemUpdates = computed(() => systemUpdateCount(updates.value))
const items = computed<NavigationMenuItem[]>(() => [
  { label: 'Servers', icon: 'i-lucide-server', to: '/' },
  { label: 'Activity', icon: 'i-lucide-history', to: '/activity' },
  {
    label: 'System',
    icon: 'i-lucide-settings',
    to: '/system',
    ...(systemUpdates.value
      ? { badge: { label: String(systemUpdates.value), color: 'info', variant: 'subtle' } }
      : {}),
  },
])
</script>

<template>
  <div class="fixed inset-0 flex flex-col overflow-hidden">
    <DiskBanner />
    <UDashboardGroup class="relative inset-auto min-h-0 flex-1">
      <UDashboardSidebar collapsible :ui="{ footer: 'border-t border-default' }">
        <template #header="{ collapsed }">
          <NuxtLink to="/" class="flex items-center gap-2 px-1">
            <img src="/flytower-mark.svg" alt="" class="size-7" />
            <span
              v-if="!collapsed"
              class="font-display text-2xl font-extrabold uppercase tracking-wide"
            >
              {{ productName }}
            </span>
          </NuxtLink>
        </template>
        <template #default="{ collapsed }">
          <UNavigationMenu :collapsed="collapsed" :items="items" orientation="vertical" />
        </template>
        <template #footer="{ collapsed }">
          <div class="flex w-full items-center gap-2">
            <span v-if="!collapsed" class="truncate text-sm text-muted">{{
              state?.user?.name
            }}</span>
            <UColorModeButton v-if="!collapsed" class="ms-auto" />
            <UButton
              icon="i-lucide-log-out"
              color="neutral"
              variant="ghost"
              aria-label="Sign out"
              @click="signOut"
            />
          </div>
        </template>
      </UDashboardSidebar>
      <slot />
    </UDashboardGroup>
  </div>
</template>
