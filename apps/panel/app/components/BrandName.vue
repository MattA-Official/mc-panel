<script setup lang="ts">
/**
 * The install's name on one line, shrunk from `max` down to `min` pixels until it fits its
 * box. Only names too long even at `min` are cut off, with the whole name on hover.
 */
const props = withDefaults(defineProps<{ name: string; max?: number; min?: number }>(), {
  max: 24,
  min: 15,
})
const el = ref<HTMLElement>()
const size = ref(props.max)

async function fit() {
  if (!el.value) return
  size.value = props.max
  await nextTick()
  // Fonts load late; measuring before they do would pick a size for the fallback face.
  await document.fonts?.ready
  while (size.value > props.min && el.value.scrollWidth > el.value.clientWidth) {
    size.value -= 1
    await nextTick()
  }
}

let observer: ResizeObserver | undefined
onMounted(() => {
  fit()
  observer = new ResizeObserver(() => fit())
  if (el.value?.parentElement) observer.observe(el.value.parentElement)
})
onBeforeUnmount(() => observer?.disconnect())
// The font can change with the branding too, through the theme stylesheet.
watch(() => [props.name, useBrand().value?.font], fit)
</script>

<template>
  <span
    ref="el"
    class="block min-w-0 truncate font-display leading-tight"
    :style="{ fontSize: `${size}px` }"
    :title="name"
    data-e2e="brand-name"
  >
    {{ name }}
  </span>
</template>
