<script setup lang="ts">
const { server } = useServerContext()
const past = ref<{ refresh: () => void } | null>(null)
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-6">
    <WorldPregen />
    <WorldCopy />
    <WorldExports v-if="server" :server="server.name" />
    <WorldPastWorlds v-if="server" ref="past" :server="server.name" />
    <WorldReset @reset="past?.refresh()" />
  </div>
</template>
