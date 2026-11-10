<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { showPoweredBy } from '#shared/branding'
import { systemUpdateCount } from '#shared/updates'

const productName = useBrandName()
const brand = useBrand()
useLiveBrand()
const { state, refresh } = useAuthState()

async function signOut() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await refresh()
  await navigateTo('/login')
}

// Updates for Flytower or Java put a count on System; server ones show on each server.
const updates = useLiveUpdates()
const can = useCan()
const systemUpdates = computed(() => (can('system.manage') ? systemUpdateCount(updates.value) : 0))

// The person's saved appearance follows them to every device.
const colorMode = useColorMode()
watch(
  () => state.value?.theme,
  (theme) => {
    if (theme) colorMode.preference = theme
  },
  { immediate: true },
)
async function toggleTheme() {
  const theme = colorMode.value === 'dark' ? 'light' : 'dark'
  colorMode.preference = theme
  await $fetch('/api/account', { method: 'PATCH', body: { theme } }).catch(() => {})
  await refresh()
}

// A change to what this person can do shows when they come back to the tab.
function onVisible() {
  if (document.visibilityState !== 'visible') return
  void refresh().then((s) => {
    if (!s.user) void navigateTo('/login')
  })
}
onMounted(() => document.addEventListener('visibilitychange', onVisible))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))
const items = computed<NavigationMenuItem[]>(() => [
  { label: 'Servers', icon: 'i-lucide-server', to: '/' },
  ...(can('people.manage') ? [{ label: 'People', icon: 'i-lucide-users', to: '/people' }] : []),
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
          <NuxtLink to="/" class="flex w-full min-w-0 items-center gap-2 px-1">
            <img
              :src="brand?.logo ?? '/flytower-mark.svg'"
              alt=""
              class="h-7 w-auto max-w-24 shrink-0 object-contain"
            />
            <BrandName v-if="!collapsed" :name="productName" class="flex-1" />
          </NuxtLink>
        </template>
        <template #default="{ collapsed }">
          <UNavigationMenu :collapsed="collapsed" :items="items" orientation="vertical" />
        </template>
        <template #footer="{ collapsed }">
          <div class="flex w-full flex-col gap-2">
            <div class="flex w-full items-center gap-1">
              <NuxtLink
                v-if="!collapsed"
                to="/account"
                class="min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-sm text-muted hover:bg-elevated hover:text-default"
                title="Your account"
                data-e2e="your-account"
              >
                {{ state?.user?.name }}
              </NuxtLink>
              <UButton
                v-if="!collapsed"
                :icon="colorMode.value === 'dark' ? 'i-lucide-moon' : 'i-lucide-sun'"
                color="neutral"
                variant="ghost"
                aria-label="Switch between light and dark"
                @click="toggleTheme"
              />
              <UButton
                icon="i-lucide-log-out"
                color="neutral"
                variant="ghost"
                aria-label="Sign out"
                @click="signOut"
              />
            </div>
            <PoweredBy v-if="!collapsed && brand && showPoweredBy(brand)" />
          </div>
        </template>
      </UDashboardSidebar>
      <slot />
    </UDashboardGroup>
  </div>
</template>
