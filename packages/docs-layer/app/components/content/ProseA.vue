<script setup lang="ts">
import { docsHref } from '../../../routes'

// Links in docs/ are relative Markdown file links (install.md#options), so they also work on
// GitHub. Here they become routes under this app's docs base (/help or /docs).
const props = defineProps<{ href?: string; target?: string }>()
const { docs } = useAppConfig()
const base = docs?.base ?? '/docs'

const to = computed(() => docsHref(props.href ?? '', base))
const external = computed(() => /^https?:/.test(to.value))
const internalDoc = computed(() => to.value.startsWith(`${base}/`) || to.value === base)

// Somewhere that shows a doc in place (the panel's help panel) can keep links inside it.
const openInPlace = inject<((to: string) => void) | null>('docsOpenInPlace', null)
function onClick(event: MouseEvent) {
  if (!openInPlace || !internalDoc.value || event.metaKey || event.ctrlKey) return
  event.preventDefault()
  openInPlace(to.value)
}
</script>

<template>
  <ULink
    :to="to"
    :target="target ?? (external ? '_blank' : undefined)"
    class="font-medium text-primary underline-offset-4 hover:underline"
    @click="onClick"
  >
    <slot />
  </ULink>
</template>
