<script setup lang="ts">
/** Pages for anyone, signed in or not: the install's brand, and nothing of the panel. */
import { showPoweredBy } from '#shared/branding'

const productName = useBrandName()
const brand = useBrand()
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header class="mx-auto flex w-full max-w-2xl items-center gap-2.5 px-4 pt-6">
      <img
        :src="brand?.logo ?? '/flytower-mark.svg'"
        alt=""
        class="h-7 w-auto max-w-28 object-contain"
      />
      <span class="font-display text-lg font-extrabold tracking-wide uppercase">{{
        productName
      }}</span>
    </header>
    <main class="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <slot />
    </main>
    <footer v-if="brand && showPoweredBy(brand)" class="flex justify-center px-4 pb-6">
      <PoweredBy />
    </footer>
  </div>
</template>
