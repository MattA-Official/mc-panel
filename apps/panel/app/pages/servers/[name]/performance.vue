<script setup lang="ts">
// Performance moved to the servers overview, so old links open this server's charts there.
definePageMeta({
  redirect: (to) => ({ path: '/', query: { metrics: String(to.params.name) } }),
})
</script>

<template>
  <div />
</template>
