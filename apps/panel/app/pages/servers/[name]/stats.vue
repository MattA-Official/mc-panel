<script setup lang="ts">
// Stats moved onto the Players tab.
definePageMeta({
  redirect: (to) => ({
    path: `/servers/${String(to.params.name)}/players`,
    query: { ...to.query, view: 'stats' },
    hash: to.hash,
  }),
})
</script>

<template>
  <div />
</template>
