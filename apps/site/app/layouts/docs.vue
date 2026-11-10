<script setup lang="ts">
import type { ContentNavigationItem } from '@nuxt/content'
import { groupBySection, pageRoute, type DocsPage } from '@flytower/docs-layer/routes'

const navigation = inject<Ref<ContentNavigationItem[] | null>>('navigation')
const base = useAppConfig().docs?.base ?? '/docs'

// Group the docs into sections from their `section` and `order` frontmatter; README is "Overview".
const groups = computed<ContentNavigationItem[]>(() => {
  const pages = (navigation?.value ?? []).flatMap(
    (item) => item.children ?? [item],
  ) as (ContentNavigationItem & DocsPage)[]
  return groupBySection(pages).map((section) => ({
    title: section.title,
    path: pageRoute(section.pages[0]?.path ?? base, base),
    children: section.pages.map((page) => {
      const path = pageRoute(page.path, base)
      return path === base ? { ...page, title: 'Overview', path, exact: true } : { ...page, path }
    }),
  }))
})
</script>

<template>
  <UContainer>
    <UPage>
      <template #left>
        <UPageAside>
          <UContentNavigation :navigation="groups" highlight :collapsible="false" />
        </UPageAside>
      </template>
      <slot />
    </UPage>
  </UContainer>
</template>
