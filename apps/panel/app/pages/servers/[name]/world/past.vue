<script setup lang="ts">
// Past worlds is now a section of World.
definePageMeta({
  redirect: (to) => ({
    path: `/servers/${String(to.params.name)}/world`,
    query: to.query,
    hash: '#past',
  }),
})
</script>

<template>
  <div />
</template>
