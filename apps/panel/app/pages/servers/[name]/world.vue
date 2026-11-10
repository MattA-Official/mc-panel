<script setup lang="ts">
const { server } = useServerContext()
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-6">
    <WorldPregen />
    <WorldCopy />
    <WorldExports v-if="server" :server="server.name" />
    <WorldReset />
  </div>
</template>
