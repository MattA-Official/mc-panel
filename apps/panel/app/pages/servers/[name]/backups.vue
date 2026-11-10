<script setup lang="ts">
// Backups moved into the World tab.
definePageMeta({
  redirect: (to) => ({
    path: `/servers/${String(to.params.name)}/world`,
    query: to.query,
    hash: to.hash,
  }),
})
</script>

<template>
  <div />
</template>
