<script setup lang="ts">
import type { ContentNavigationItem } from '@nuxt/content'
import { pageRoute, routeToPage } from '@flytower/docs-layer/routes'

// Help, full-page: the docs for this version of Flytower, with the pages on the left and
// the page's contents on the right.
const route = useRoute()
// :ui chips in the page show their control in the panel (#270).
const { show: showMe } = useShowMe()
provide('docsShowMe', (anchor: string, press?: boolean) => void showMe(anchor, press))
provide('docsValue', useDocValues())
const { docs } = useAppConfig()
const base = docs?.base ?? '/help'
const path = computed(() => routeToPage(route.path, base))

const { data: page, status } = await useAsyncData(
  () => `help:${path.value}`,
  () => queryCollection('docs').path(path.value).first(),
)
useHead({ title: () => (page.value ? `${page.value.title} · Help` : 'Help') })

const navigation = useDocsNavigation()
const { data: surround } = await useAsyncData(
  () => `help-surround:${path.value}`,
  () => queryCollectionItemSurroundings('docs', path.value, { fields: ['description'] }),
)

/**
 * Previous and next follow the navigation's order rather than file names. A missing side is
 * null, which UContentSurround leaves as a gap (its types don't allow for it).
 */
const neighbours = computed(() => {
  const flat = navigation.value.flatMap((s) => s.children ?? [])
  const i = flat.findIndex((p) => p.path === pageRoute(path.value, base))
  const pair = i < 0 ? (surround.value ?? []) : [flat[i - 1] ?? null, flat[i + 1] ?? null]
  return pair as ContentNavigationItem[]
})

const pagesOpen = ref(false)
watch(
  () => route.path,
  () => (pagesOpen.value = false),
)

// Jump to the heading in the address once the page has rendered.
onMounted(async () => {
  if (!route.hash) return
  await nextTick()
  document.querySelector(`[id="${CSS.escape(route.hash.slice(1))}"]`)?.scrollIntoView()
})
</script>

<template>
  <UDashboardPanel id="help">
    <template #header>
      <UDashboardNavbar title="Help">
        <template #right>
          <UButton
            label="Pages"
            icon="i-lucide-list"
            color="neutral"
            variant="ghost"
            class="lg:hidden"
            @click="pagesOpen = true"
          />
          <UContentSearchButton :collapsed="false" class="hidden sm:inline-flex" />
          <UContentSearchButton class="sm:hidden" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UPage :ui="{ root: 'lg:gap-8', left: 'lg:col-span-2', center: 'lg:col-span-6' }">
        <template #left>
          <aside
            class="sticky top-0 hidden max-h-[calc(100dvh-var(--ui-header-height)-3rem)] overflow-y-auto pe-2 lg:block"
          >
            <UContentNavigation :navigation="navigation" highlight :collapsible="false" />
          </aside>
        </template>

        <div v-if="status === 'pending' && !page" class="space-y-3 py-4">
          <USkeleton class="h-9 w-1/2" />
          <USkeleton class="h-4 w-full" />
          <USkeleton class="h-4 w-4/5" />
        </div>
        <template v-else-if="page">
          <div class="pb-2">
            <UBadge
              v-if="page.since"
              :label="`Since ${page.since}`"
              color="neutral"
              variant="subtle"
              size="sm"
              class="mb-2"
            />
            <ContentRenderer :value="page" class="help-prose" />
          </div>
          <UContentSurround :surround="neighbours" class="mt-10" />
        </template>
        <UEmpty
          v-else
          icon="i-lucide-file-question"
          title="No help page here"
          description="It may have moved in this version of Flytower."
          :actions="[{ label: 'All help', to: base, icon: 'i-lucide-book-open' }]"
        />

        <template v-if="page?.body?.toc?.links?.length" #right>
          <UContentToc :links="page.body.toc.links" title="On this page" highlight class="top-0" />
        </template>
      </UPage>

      <USlideover v-model:open="pagesOpen" side="left" title="Help pages">
        <template #body>
          <UContentNavigation :navigation="navigation" highlight :collapsible="false" />
        </template>
      </USlideover>
    </template>
  </UDashboardPanel>
</template>
