<script setup lang="ts">
// The web map is now a section of World.
definePageMeta({
  redirect: (to) => ({
    path: `/servers/${String(to.params.name)}/world`,
    query: to.query,
    hash: '#map',
  }),
})
</script>

<template>
  <div />
</template>
