<script setup lang="ts">
import { showPoweredBy } from '#shared/branding'

const productName = useBrandName()
const brand = useBrand()
</script>

<template>
  <main class="min-h-dvh flex flex-col items-center justify-center gap-8 p-4">
    <div class="flex items-center gap-3">
      <img
        :src="brand?.logo ?? '/flytower-mark.svg'"
        alt=""
        class="h-10 w-auto max-w-40 object-contain"
      />
      <span class="font-display text-4xl font-extrabold uppercase tracking-wide">{{
        productName
      }}</span>
    </div>
    <div class="w-full max-w-md">
      <slot />
    </div>
    <PoweredBy v-if="brand && showPoweredBy(brand)" />
  </main>
</template>
