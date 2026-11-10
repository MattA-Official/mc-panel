<script setup lang="ts">
// Links in docs/ are written as relative Markdown file links (install.md#options) so they also
// work on GitHub. Nuxt Content turns those into bare relative links (install#options); on the
// site they become routes under /docs (/docs/install#options).
const props = defineProps<{ href?: string; target?: string }>()
const route = useRoute()

const to = computed(() => {
  const href = props.href ?? ''
  if (/^[a-z]+:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return href
  const match = href.match(/^(?:\.\/)?([\w-]+)(?:\.md)?(#.*)?$/)
  if (!match || !route.path.startsWith('/docs')) return href
  const [, file, hash = ''] = match
  return `${/^readme$/i.test(file ?? '') ? '/docs' : `/docs/${file}`}${hash}`
})
const external = computed(() => /^https?:/.test(to.value))
</script>

<template>
  <ULink
    :to="to"
    :target="target ?? (external ? '_blank' : undefined)"
    class="font-medium text-primary underline-offset-4 hover:underline"
  >
    <slot />
  </ULink>
</template>
