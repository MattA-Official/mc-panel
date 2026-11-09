<script setup lang="ts">
const { productName } = useAppConfig()
</script>

<template>
  <main class="min-h-dvh flex flex-col items-center justify-center gap-8 p-4">
    <div class="flex items-center gap-3">
      <img src="/flytower-mark.svg" alt="" class="size-10" />
      <span class="font-display text-4xl font-extrabold uppercase tracking-wide">{{
        productName
      }}</span>
    </div>
    <div class="w-full max-w-md">
      <slot />
    </div>
  </main>
</template>
