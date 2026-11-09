<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const { productName } = useAppConfig()

const items: NavigationMenuItem[] = [
  { label: 'Servers', icon: 'i-lucide-server', to: '/' },
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
        <UColorModeButton v-if="!collapsed" />
      </template>
    </UDashboardSidebar>
    <slot />
  </UDashboardGroup>
</template>
