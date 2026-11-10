<script setup lang="ts">
const { server } = useServerContext()
</script>

<template>
  <div v-if="server" class="mx-auto w-full max-w-5xl space-y-6">
    <WorldPastWorlds :server="server.name" />
    <WorldExports :server="server.name" />
  </div>
</template>
