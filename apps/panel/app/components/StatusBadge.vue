<script setup lang="ts">
const props = defineProps<{ status: ServiceState; condition?: Condition }>()

type Look = {
  label: string
  color: 'success' | 'warning' | 'neutral' | 'error'
  icon: string
}
const STATES: Record<ServiceState, Look> = {
  active: { label: 'Running', color: 'success', icon: 'i-lucide-circle-play' },
  activating: { label: 'Starting', color: 'warning', icon: 'i-lucide-loader-circle' },
  deactivating: { label: 'Stopping', color: 'warning', icon: 'i-lucide-loader-circle' },
  inactive: { label: 'Stopped', color: 'neutral', icon: 'i-lucide-circle-stop' },
  failed: { label: 'Crashed', color: 'error', icon: 'i-lucide-circle-x' },
  unknown: { label: 'Unknown', color: 'neutral', icon: 'i-lucide-circle-help' },
}

const look = computed<Look>(() => {
  const { status, condition } = props
  if (condition === 'crash-loop' && status !== 'active') {
    return { label: 'Crash-looping', color: 'error', icon: 'i-lucide-repeat' }
  }
  if (condition === 'crashed' && status === 'activating') {
    return { label: 'Restarting after a crash', color: 'warning', icon: 'i-lucide-loader-circle' }
  }
  if (condition === 'unresponsive' && status === 'active') {
    return { label: 'Not responding', color: 'warning', icon: 'i-lucide-hourglass' }
  }
  return STATES[status]
})
const spinning = computed(() => look.value.icon === 'i-lucide-loader-circle')
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
