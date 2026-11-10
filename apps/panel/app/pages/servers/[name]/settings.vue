<script setup lang="ts">
const { server } = useServerContext()
const base = computed(() => `/servers/${server.value?.name}/settings`)
const sections = computed(() => [
  { label: 'General', icon: 'i-lucide-sliders-horizontal', to: base.value, exact: true },
  { label: 'Community', icon: 'i-lucide-megaphone', to: `${base.value}/community` },
  { label: 'Schedules', icon: 'i-lucide-calendar-clock', to: `${base.value}/schedules` },
  { label: 'Maintenance', icon: 'i-lucide-wrench', to: `${base.value}/maintenance` },
  { label: 'YAML', icon: 'i-lucide-file-code', to: `${base.value}/yaml` },
])
</script>

<template>
  <SectionLayout :sections="sections" label="Settings">
    <NuxtPage />
  </SectionLayout>
</template>
