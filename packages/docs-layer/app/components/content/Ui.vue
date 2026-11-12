<script setup lang="ts">
import { docAnchor } from '../../../anchors'

/**
 * `:ui{anchor="backups.back-up-now"}` in docs/: names a button, field or section of the panel
 * (#270). On the website it's a chip that looks like the control. In the panel's Help it's a
 * button that goes to the control and lights it up ("Show me"). The chip's words are the
 * control's own label unless the Markdown gives some: `:ui[Back up]{anchor="…"}`.
 */
const props = defineProps<{ anchor: string }>()
const control = computed(() => docAnchor(props.anchor))

// The panel provides this; the website doesn't, so there the chip is just a picture.
const showMe = inject<((anchor: string) => void) | null>('docsShowMe', null)

const kindIcon = {
  button: 'i-lucide-mouse-pointer-click',
  field: 'i-lucide-text-cursor-input',
  section: 'i-lucide-panel-top',
  card: 'i-lucide-square',
} as const
const icon = computed(() =>
  control.value ? (control.value.icon ?? kindIcon[control.value.kind]) : null,
)
</script>

<template>
  <button
    v-if="showMe && control"
    type="button"
    class="doc-ui doc-ui-live"
    :title="`Show me ${control.label}`"
    :data-doc-chip="anchor"
    @click="showMe(anchor)"
  >
    <UIcon v-if="icon" :name="icon" class="doc-ui-icon" />
    <span
      ><slot>{{ control.label }}</slot></span
    >
    <UIcon name="i-lucide-locate-fixed" class="doc-ui-icon doc-ui-locate" />
    <span class="sr-only">(show me)</span>
  </button>
  <span v-else class="doc-ui" :data-doc-chip="anchor">
    <UIcon v-if="icon" :name="icon" class="doc-ui-icon" />
    <span
      ><slot>{{ control?.label ?? anchor }}</slot></span
    >
  </span>
</template>

<style scoped>
.doc-ui {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  padding: 0 0.45em;
  border: 1px solid var(--ui-border-accented);
  border-radius: calc(var(--ui-radius) * 1.5);
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
  font-size: 0.875em;
  font-weight: 500;
  line-height: 1.6;
  white-space: nowrap;
  vertical-align: baseline;
}
.doc-ui-icon {
  width: 1em;
  height: 1em;
  flex-shrink: 0;
  color: var(--ui-text-muted);
}
.doc-ui-live {
  cursor: pointer;
}
.doc-ui-live:hover,
.doc-ui-live:focus-visible {
  border-color: var(--ui-primary);
}
.doc-ui-live:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 1px;
}
.doc-ui-locate {
  color: var(--ui-primary);
}
</style>
