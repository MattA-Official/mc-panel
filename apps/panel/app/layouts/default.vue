<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const { productName } = useAppConfig()
const { state, refresh } = useAuthState()

async function signOut() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await refresh()
  await navigateTo('/login')
}

const items: NavigationMenuItem[] = [
  { label: 'Servers', icon: 'i-lucide-server', to: '/' },
  { label: 'Activity', icon: 'i-lucide-history', to: '/activity' },
  { label: 'System', icon: 'i-lucide-settings', to: '/system' },
]
</script>

<template>
  <UDashboardGroup>
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
          <span v-if="!collapsed" class="truncate text-sm text-muted">{{ state?.user?.name }}</span>
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
</template>
