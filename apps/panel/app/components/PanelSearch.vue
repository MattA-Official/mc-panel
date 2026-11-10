<script setup lang="ts">
import type { ContentNavigationItem } from '@nuxt/content'

/**
 * The command palette (#107), on Ctrl + K (⌘K on a Mac) and the sidebar's Search button.
 * Servers come first, then the tabs and actions of the server you're on (or, once you
 * type, of every server), then the panel's pages, then the help pages. Built on Nuxt UI's
 * command palette rather than its content search so servers aren't buried under help.
 */
const props = defineProps<{
  pages: PaletteLink[]
  serverGroups: (query: string) => PaletteGroup[]
  navigation: ContentNavigationItem[]
  files: Parameters<ReturnType<typeof useContentSearch>['mapNavigationItems']>[1]
}>()

const { open, mapNavigationItems, postFilter } = useContentSearch()
const searchTerm = ref('')
watch(open, (o) => !o && (searchTerm.value = ''))

defineShortcuts({
  meta_k: { usingInput: true, handler: () => (open.value = !open.value) },
})

const groups = computed(() => {
  const typing = searchTerm.value.trim() !== ''
  const docs = typing
    ? props.navigation.map((section) => ({
        id: `help-${section.path}`,
        label: `Help: ${section.title}`,
        items: mapNavigationItems(section.children ?? [], props.files),
        postFilter,
      }))
    : []
  return [
    ...props.serverGroups(searchTerm.value),
    {
      id: 'pages',
      label: 'Pages',
      items: props.pages.map((p) => ({ ...p, suffix: p.description, description: undefined })),
    },
    ...docs,
  ]
})

function onSelect(item: { disabled?: boolean } | undefined) {
  if (item?.disabled) return
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" title="Search" description="Find a server, page or action">
    <template #content>
      <UCommandPalette
        v-model:search-term="searchTerm"
        :groups="groups"
        :fuse="{ fuseOptions: { includeMatches: true, useTokenSearch: true }, resultLimit: 12 }"
        preserve-group-order
        :input="{ fixed: true }"
        close
        placeholder="Find a server, page or action, or search help…"
        class="h-[min(32rem,80dvh)]"
        data-e2e="command-palette"
        @update:model-value="onSelect"
        @update:open="open = $event"
      />
    </template>
  </UModal>
</template>
