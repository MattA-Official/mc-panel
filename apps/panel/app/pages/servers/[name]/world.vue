<script setup lang="ts">
const { server } = useServerContext()
const base = computed(() => `/servers/${server.value?.name}/world`)
const sections = computed(() => [
  { label: 'Backups', icon: 'i-lucide-archive', to: base.value, exact: true },
  { label: 'Web map', icon: 'i-lucide-map', to: `${base.value}/map` },
  { label: 'Past worlds', icon: 'i-lucide-history', to: `${base.value}/past` },
  { label: 'Tools', icon: 'i-lucide-wrench', to: `${base.value}/tools` },
])
</script>

<template>
  <SectionLayout :sections="sections" label="World">
    <NuxtPage />
  </SectionLayout>
</template>
