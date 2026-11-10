<script setup lang="ts">
// Access is a section of Settings.
definePageMeta({
  redirect: (to) => ({
    path: `/servers/${String(to.params.name)}/settings`,
    query: to.query,
    hash: '#access',
  }),
})
</script>

<template>
  <div />
</template>
