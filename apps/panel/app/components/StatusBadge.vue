<script setup lang="ts">
const props = defineProps<{ status: ServiceState }>()

const look = computed(
  () =>
    ({
      active: { label: 'Running', color: 'success', icon: 'i-lucide-circle-play' },
      activating: { label: 'Starting', color: 'warning', icon: 'i-lucide-loader-circle' },
      deactivating: { label: 'Stopping', color: 'warning', icon: 'i-lucide-loader-circle' },
      inactive: { label: 'Stopped', color: 'neutral', icon: 'i-lucide-circle-stop' },
      failed: { label: 'Crashed', color: 'error', icon: 'i-lucide-circle-x' },
      unknown: { label: 'Unknown', color: 'neutral', icon: 'i-lucide-circle-help' },
    })[props.status] as {
      label: string
      color: 'success' | 'warning' | 'neutral' | 'error'
      icon: string
    },
)
const spinning = computed(() => props.status === 'activating' || props.status === 'deactivating')
</script>

<template>
  <UBadge
    :color="look.color"
    variant="subtle"
    :label="look.label"
    :icon="look.icon"
    :ui="{ leadingIcon: spinning ? 'animate-spin' : '' }"
  />
</template>
