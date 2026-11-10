<script setup lang="ts">
// Schedules is now a section of Settings.
definePageMeta({
  redirect: (to) => ({
    path: `/servers/${String(to.params.name)}/settings`,
    query: to.query,
    hash: '#schedules',
  }),
})
</script>

<template>
  <div />
</template>
