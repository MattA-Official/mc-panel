<script setup lang="ts">
const route = useRoute()
const path = `/legal/${route.params.slug}`
const { data: page } = await useAsyncData(`legal:${path}`, () =>
  queryCollection('legal').path(path).first(),
)

useSeoMeta({ title: page.value?.title ?? 'Coming soon', description: page.value?.description })
</script>

<template>
  <UContainer class="max-w-3xl py-12">
    <template v-if="page">
      <UPageHeader :title="page.title" :description="page.description" />
      <p v-if="page.lastUpdated" class="mt-4 text-sm text-muted">
        Last updated {{ page.lastUpdated }}
      </p>
      <ContentRenderer :value="page" class="mt-8" />
    </template>
    <!-- Legal pages are drafted separately; until one lands, say so plainly rather than 404. -->
    <UPageHeader
      v-else
      title="Coming soon"
      description="This page is being written and will be published before the site launches."
    />
  </UContainer>
</template>
