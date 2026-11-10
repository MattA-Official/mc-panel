<script setup lang="ts">
/** Shown on every page while the disk is 95% full or more, since a full disk can corrupt a world. */
const { data, refresh } = useDiskStatus()
const route = useRoute()
// Cheap to ask (the panel answers from memory), so look again on every page change.
watch(
  () => route.path,
  () => void refresh(),
)
const free = computed(() =>
  data.value?.totalMb != null && data.value.usedMb != null
    ? humanMb(data.value.totalMb - data.value.usedMb)
    : null,
)
</script>

<template>
  <UAlert
    v-if="data?.level === 'urgent'"
    color="error"
    variant="solid"
    icon="i-lucide-hard-drive"
    :title="`The disk is ${Math.round(data.percent ?? 0)}% full${free ? `, with ${free} left` : ''}`"
    description="Scheduled backups are paused until there's more room. If the disk fills up, a server can corrupt its world while saving."
    :actions="
      route.path === '/system'
        ? []
        : [{ label: 'See what’s using it', color: 'neutral', variant: 'subtle', to: '/system' }]
    "
    orientation="horizontal"
    class="rounded-none"
    data-e2e="disk-banner"
  />
</template>
