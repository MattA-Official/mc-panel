<script setup lang="ts">
const name = useBrandName()
await callOnce('brand', loadBrand)
// Read the name in the getter, so the tab's title follows a rename straight away.
useHead(() => {
  const n = name.value
  return { titleTemplate: (t?: string) => (t ? `${t} · ${n}` : n) }
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
