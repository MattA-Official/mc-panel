<script setup lang="ts">
definePageMeta({ layout: 'docs' })

const route = useRoute()
// docs/README.md is the docs home page.
const path = computed(() =>
  route.path.replace(/\/$/, '') === '/docs' ? '/docs/readme' : route.path.replace(/\/$/, ''),
)

const { data: page } = await useAsyncData(`docs:${path.value}`, () =>
  queryCollection('docs').path(path.value).first(),
)
if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
}

const { data: surround } = await useAsyncData(`docs-surround:${path.value}`, () =>
  queryCollectionItemSurroundings('docs', path.value, { fields: ['description'] }),
)

const site = useAppConfig().site
const editLink = computed(
  () =>
    `${site.repo}/edit/main/${page.value?.stem ? `docs/${page.value.stem.split('/').pop()}.md` : 'docs'}`,
)

useSeoMeta({
  title: page.value.title,
  description: page.value.description,
})
</script>

<template>
  <UPage v-if="page">
    <!-- Each doc starts with its own H1, so there is no separate page header. -->
    <UPageBody class="mt-8">
      <ContentRenderer :value="page" />

      <USeparator class="my-6" />
      <ULink :to="editLink" target="_blank" class="text-sm text-muted hover:text-default">
        <UIcon name="i-lucide-pencil" class="mr-1 align-middle" />Suggest a change on GitHub
      </ULink>
      <UContentSurround :surround="surround ?? []" />
    </UPageBody>

    <template v-if="page.body?.toc?.links?.length" #right>
      <UContentToc :links="page.body.toc.links" title="On this page">
        <template #bottom>
          <AdSlot class="mt-6 hidden lg:block" />
        </template>
      </UContentToc>
    </template>
  </UPage>
</template>
