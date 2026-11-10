<script setup lang="ts">
import type { ContentNavigationItem } from '@nuxt/content'

const navigation = inject<Ref<ContentNavigationItem[] | null>>('navigation')
const { docsNav } = useAppConfig()

// Group the flat docs list into the sections from app.config, in reading order.
const groups = computed<ContentNavigationItem[]>(() => {
  const all = (navigation?.value ?? []).flatMap((item) => item.children ?? [item])
  const byPath = new Map(all.map((item) => [item.path, item]))
  return docsNav.map((section) => ({
    title: section.title,
    path: section.pages[0] ?? '/docs',
    children: section.pages
      .map((path) => byPath.get(path))
      .filter((item): item is ContentNavigationItem => !!item)
      .map((item) =>
        item.path === '/docs/readme'
          ? { ...item, title: 'Overview', path: '/docs', exact: true }
          : item,
      ),
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
