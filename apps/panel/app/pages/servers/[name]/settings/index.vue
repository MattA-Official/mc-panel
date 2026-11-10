<script setup lang="ts">
import type { CollapsibleSection } from '~/components/CollapsibleSections.vue'

const { server, status } = useServerContext()
const toast = useToast()

// Minecraft reads its settings at start-up, so saving while it runs needs a restart.
const needsRestart = ref(false)
function saved() {
  if (status.value === 'active' || status.value === 'activating') needsRestart.value = true
}
const restarting = ref(false)
const can = useCan()
const configText = "You can see this server's settings but not change them."
const sections = computed<CollapsibleSection[]>(() => [
  {
    id: 'general',
    label: 'General',
    icon: 'i-lucide-sliders-horizontal',
    description: 'Game rules, memory, version and address',
    need: { permission: 'server.configure', text: configText },
  },
  {
    id: 'community',
    label: 'Community',
    icon: 'i-lucide-users',
    description: 'Public page, stats and Discord chat',
    summary: server.value
      ? [
          server.value.publicPage.enabled ? 'Public page on' : 'Public page off',
          server.value.discordRelay?.configured ? 'Discord on' : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null,
    need: { permission: 'server.configure', text: configText },
  },
  {
    id: 'schedules',
    label: 'Schedules',
    icon: 'i-lucide-calendar-clock',
    description: 'Restarts, commands and announcements on a timer',
    need: {
      permission: 'server.configure',
      text: 'You can see the schedules but not change or run them.',
    },
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    icon: 'i-lucide-wrench',
    description: 'Crash recovery, disk, copying and deleting',
    need: { permission: 'server.configure', text: configText },
  },
])
async function restart() {
  if (!server.value) return
  restarting.value = true
  try {
    await $fetch(`/api/servers/${server.value.name}/restart` as string, { method: 'POST' })
    needsRestart.value = false
  } catch (err) {
    toast.add({ title: "Couldn't restart", description: errorMessage(err), color: 'error' })
  } finally {
    restarting.value = false
  }
}
</script>

<template>
  <CollapsibleSections
    v-if="server"
    :sections="sections"
    storage-key="settings"
    :default-open="['general']"
  >
    <template #general>
      <div class="space-y-6">
        <UAlert
          v-if="needsRestart"
          color="warning"
          variant="subtle"
          icon="i-lucide-rotate-cw"
          title="Restart to apply"
          description="The server reads its settings when it starts. Anyone playing will be disconnected briefly."
          :actions="[
            { label: 'Restart now', color: 'warning', loading: restarting, onClick: restart },
            {
              label: 'Later',
              color: 'neutral',
              variant: 'ghost',
              onClick: () => (needsRestart = false),
            },
          ]"
        />
        <ServerProperties @saved="saved" />
        <ServerResources @saved="saved" />
        <ServerVersion />
        <ServerAddress />
      </div>
    </template>
    <template #community>
      <div class="space-y-6">
        <ServerPublicPage />
        <ServerStats />
        <ServerDiscordChat />
      </div>
    </template>
    <template #schedules>
      <ServerSchedules />
    </template>
    <template #maintenance>
      <div class="space-y-6">
        <ServerRecovery />
        <ServerDisk />
        <ServerClone />
        <ServerDangerZone />
      </div>
    </template>
    <template #after>
      <NuxtLink
        :to="`/servers/${server.name}/settings/yaml`"
        class="flex items-center gap-3 rounded-lg border border-dashed border-default px-4 py-3 hover:bg-elevated/50 focus-visible:outline-2 focus-visible:outline-primary"
        data-e2e="settings-yaml"
      >
        <UIcon name="i-lucide-file-code" class="size-5 shrink-0 text-muted" />
        <span class="min-w-0 flex-1">
          <span class="block font-semibold">Edit as YAML</span>
          <span class="block truncate text-sm text-muted">
            Everything above as one file{{
              can('server.configure', server.name) ? ', with a review before it applies' : ''
            }}
          </span>
        </span>
        <UIcon name="i-lucide-chevron-right" class="size-5 shrink-0 text-muted" />
      </NuxtLink>
    </template>
  </CollapsibleSections>
</template>
