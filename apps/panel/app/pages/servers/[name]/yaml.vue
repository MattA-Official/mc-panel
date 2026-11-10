<script setup lang="ts">
// The YAML editor moved into Settings.
definePageMeta({
  redirect: (to) => ({
    path: `/servers/${String(to.params.name)}/settings/yaml`,
    query: to.query,
    hash: to.hash,
  }),
})
</script>

<template>
  <div />
</template>
