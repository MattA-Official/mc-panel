<script setup lang="ts">
const { server } = useServerContext()
useHead({ title: () => `Stats · ${server.value?.displayName ?? ''}` })
</script>

<template>
  <ServerStatsOverview />
</template>
