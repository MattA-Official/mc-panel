<script setup lang="ts">
import type { NuxtError } from '#app'

defineProps<{ error: NuxtError }>()
useSeoMeta({ title: 'Page not found' })
</script>

<template>
  <UApp>
    <SiteHeader />
    <UMain>
      <UContainer class="py-24">
        <UError
          :error="{
            statusCode: error.statusCode,
            statusMessage: error.statusCode === 404 ? 'Nothing on stage here' : error.statusMessage,
            message:
              error.statusCode === 404
                ? 'This page has flown out. Try the docs or the home page.'
                : error.message,
          }"
        />
      </UContainer>
    </UMain>
    <SiteFooter />
  </UApp>
</template>
