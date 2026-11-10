<script setup lang="ts">
const site = useAppConfig().site

// Navigation and search data for every docs page, fetched once at build time and stored in
// each prerendered page's payload, so visitors never query a database.
const { data: navigation } = await useAsyncData('docs-navigation', () =>
  queryCollectionNavigation('docs'),
)
const { data: searchFiles } = useLazyAsyncData(
  'docs-search',
  () => queryCollectionSearchSections('docs'),
  { server: true },
)
provide('navigation', navigation)

useHead({
  titleTemplate: (title) => (title && title !== site.name ? `${title} · ${site.name}` : site.name),
})
useSeoMeta({ description: site.tagline, ogSiteName: site.name })
</script>

<template>
  <UApp>
    <SiteHeader />
    <UMain>
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </UMain>
    <SiteFooter />
    <ClientOnly>
      <LazyUContentSearch
        :files="searchFiles ?? []"
        :navigation="navigation ?? []"
        :fuse="{ resultLimit: 30 }"
      />
    </ClientOnly>
  </UApp>
</template>
