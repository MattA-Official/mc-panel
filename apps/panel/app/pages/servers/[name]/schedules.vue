<script setup lang="ts">
// Schedules moved into Settings.
definePageMeta({
  redirect: (to) => ({
    path: `/servers/${String(to.params.name)}/settings/schedules`,
    query: to.query,
    hash: to.hash,
  }),
})
</script>

<template>
  <div />
</template>
