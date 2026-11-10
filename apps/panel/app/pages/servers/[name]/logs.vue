<script setup lang="ts">
// Logs moved into a pop-up on the Console, so old links open it there.
definePageMeta({
  redirect: (to) => ({
    path: `/servers/${String(to.params.name)}`,
    query: { logs: String(to.query.log ?? '') },
    hash: to.hash,
  }),
})
</script>

<template>
  <div />
</template>
