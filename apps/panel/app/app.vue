<script setup lang="ts">
const { productName } = useAppConfig()
useHead({ titleTemplate: (t) => (t ? `${t} · ${productName}` : productName) })
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
