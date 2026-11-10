<script setup lang="ts">
const { server } = useServerContext()
useHead({ title: () => `Performance · ${server.value?.displayName ?? ''}` })
</script>

<template>
  <MetricsHistory v-if="server" :server="server.name" class="mx-auto w-full max-w-5xl" />
</template>
