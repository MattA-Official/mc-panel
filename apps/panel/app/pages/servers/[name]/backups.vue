<script setup lang="ts">
// Backups are now a section of World.
definePageMeta({
  redirect: (to) => ({
    path: `/servers/${String(to.params.name)}/world`,
    query: to.query,
    hash: '#backups',
  }),
})
</script>

<template>
  <div />
</template>
