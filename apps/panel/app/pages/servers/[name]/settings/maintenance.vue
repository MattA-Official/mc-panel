<script setup lang="ts">
// Maintenance is now a section of Settings.
definePageMeta({
  redirect: (to) => ({
    path: `/servers/${String(to.params.name)}/settings`,
    query: to.query,
    hash: '#maintenance',
  }),
})
</script>

<template>
  <div />
</template>
