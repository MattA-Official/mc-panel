<script setup lang="ts">
const { server } = useServerContext()
/** Bumped after a reset, so Past worlds shows the world just kept. */
const resets = ref(0)
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-6">
    <WorldPregen />
    <WorldCopy />
    <WorldExports v-if="server" :server="server.name" />
    <WorldPastWorlds v-if="server" :server="server.name" :version="resets" />
    <WorldReset @reset="resets++" />
  </div>
</template>
