<script setup lang="ts">
/**
 * `:shortcut{keys="meta+k"}` in docs/: key caps for a keyboard shortcut (#270). `meta` shows
 * as ⌘ on a Mac and Ctrl elsewhere, like the panel's own shortcut sheet. Keys are joined
 * with `+`; a space separates keys pressed one after the other, like `g s`.
 */
const props = defineProps<{ keys: string }>()
const steps = computed(() =>
  props.keys
    .trim()
    .split(/\s+/)
    .map((step) => step.split('+').filter(Boolean)),
)
</script>

<template>
  <span class="inline-flex items-center gap-1 align-baseline whitespace-nowrap">
    <template v-for="(step, i) in steps" :key="i">
      <span v-if="i" class="text-xs text-muted">then</span>
      <span class="inline-flex items-center gap-0.5">
        <UKbd v-for="key in step" :key="key" :value="key" />
      </span>
    </template>
  </span>
</template>
