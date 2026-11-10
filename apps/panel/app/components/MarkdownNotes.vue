<script setup lang="ts">
/** Release notes and similar short Markdown, drawn as real headings, lists and links. */
import type { Inline } from '#shared/utils/markdown'

const props = defineProps<{ source: string }>()
const blocks = computed(() => parseNotes(props.source))

function inline(parts: Inline[]) {
  return parts.map((p) => {
    if (p.type === 'strong') return h('strong', { class: 'font-semibold text-default' }, p.text)
    if (p.type === 'code') return h('code', { class: 'font-mono text-xs' }, p.text)
    if (p.type === 'link') {
      return h(
        'a',
        {
          href: p.href,
          target: '_blank',
          rel: 'noopener noreferrer',
          class: 'text-primary hover:underline break-all',
        },
        p.text,
      )
    }
    return p.text
  })
}

const Notes = () =>
  blocks.value.map((b) => {
    if (b.type === 'heading') {
      return h('p', { class: 'mt-3 first:mt-0 font-semibold text-default' }, inline(b.content))
    }
    if (b.type === 'list') {
      return h(
        'ul',
        { class: 'mt-1 list-disc space-y-1 pl-5' },
        b.items.map((i) => h('li', inline(i))),
      )
    }
    return h('p', { class: 'mt-2' }, inline(b.content))
  })
</script>

<template>
  <div class="text-sm text-muted"><Notes /></div>
</template>
