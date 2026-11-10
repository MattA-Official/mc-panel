<script setup lang="ts">
// Community is now a section of Settings.
definePageMeta({
  redirect: (to) => ({
    path: `/servers/${String(to.params.name)}/settings`,
    query: to.query,
    hash: '#community',
  }),
})
</script>

<template>
  <div />
</template>
