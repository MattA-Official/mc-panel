<script setup lang="ts">
// World tools are now a section of World.
definePageMeta({
  redirect: (to) => ({
    path: `/servers/${String(to.params.name)}/world`,
    query: to.query,
    hash: '#tools',
  }),
})
</script>

<template>
  <div />
</template>
