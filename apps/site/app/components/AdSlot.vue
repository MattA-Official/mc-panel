<script setup lang="ts">
// One labelled ad slot in the docs sidebar. Until an ad network accepts the site it shows an
// "Advertise here" placeholder the same size as a real ad, so nothing moves when ads arrive.
</script>

<template>
  <aside
    aria-label="Advertisement"
    class="rounded-md border border-dashed border-default p-3 text-sm"
  >
    <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-dimmed">Ad</p>
    <p class="text-muted">Reach people who run their own Minecraft servers.</p>
    <ULink to="/advertise" rel="sponsored" class="mt-2 inline-block font-medium text-primary"
      >Advertise here</ULink
    >
  </aside>
</template>
