<script setup lang="ts">
import type { SpecIssue } from '#shared/spec'

/** A plain YAML editor: a textarea with line numbers and marks on lines with problems. */
const props = defineProps<{ issues?: SpecIssue[]; label?: string }>()
const model = defineModel<string>({ required: true })

const area = ref<HTMLTextAreaElement | null>(null)
const gutter = ref<HTMLDivElement | null>(null)
const lineCount = computed(() => Math.max(model.value.split('\n').length, 1))
const bad = computed(() => new Set((props.issues ?? []).map((i) => i.line).filter(Boolean)))

function syncScroll() {
  if (gutter.value && area.value) gutter.value.scrollTop = area.value.scrollTop
}

/** Tab inserts two spaces, as YAML wants. */
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Tab' || e.shiftKey || !area.value) return
  e.preventDefault()
  const el = area.value
  const { selectionStart: s, selectionEnd: end } = el
  model.value = `${model.value.slice(0, s)}  ${model.value.slice(end)}`
  nextTick(() => el.setSelectionRange(s + 2, s + 2))
}

function goToLine(n: number) {
  const el = area.value
  if (!el) return
  const lines = model.value.split('\n')
  const start = lines.slice(0, n - 1).reduce((acc, l) => acc + l.length + 1, 0)
  el.focus()
  el.setSelectionRange(start, start + (lines[n - 1]?.length ?? 0))
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20
  el.scrollTop = Math.max(0, (n - 4) * lineHeight)
  syncScroll()
}

defineExpose({ goToLine })
</script>

<template>
  <div
    class="flex overflow-hidden rounded-md border border-default bg-default font-mono text-sm leading-5 focus-within:ring-2 focus-within:ring-primary"
  >
    <div
      ref="gutter"
      aria-hidden="true"
      class="select-none overflow-hidden border-r border-default bg-elevated/50 py-2 text-right text-dimmed"
    >
      <div
        v-for="n in lineCount"
        :key="n"
        class="px-2"
        :class="bad.has(n) ? 'bg-error/15 font-semibold text-error' : ''"
      >
        {{ n }}
      </div>
    </div>
    <textarea
      ref="area"
      v-model="model"
      :aria-label="label ?? 'Server spec in YAML'"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      wrap="off"
      class="min-h-[28rem] w-full resize-y overflow-auto bg-transparent px-3 py-2 outline-none"
      @scroll="syncScroll"
      @keydown="onKeydown"
    />
  </div>
</template>
