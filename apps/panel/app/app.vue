<script setup lang="ts">
const name = useBrandName()
await callOnce('brand', loadBrand)
useHead({ titleTemplate: (t) => (t ? `${t} · ${name.value}` : name.value) })
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
