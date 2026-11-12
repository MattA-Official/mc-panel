<script setup lang="ts">
import { docValue } from '../../../values'

/**
 * `:value{of="server.address"}` in docs/: a live value (#270). In the panel's Help it shows
 * yours, such as the address players join with. On the website, or when the panel can't
 * tell, it reads as words instead: "your server's address", or `:value[these words]{of="…"}`.
 */
const props = defineProps<{ of: string }>()
const known = computed(() => docValue(props.of))

// The panel provides this; the website doesn't.
const read = inject<((of: string) => string | null) | null>('docsValue', null)
const live = computed(() => (known.value && read ? read(props.of) : null))
</script>

<template>
  <code v-if="live" class="doc-value" :data-doc-value="of">{{ live }}</code>
  <span v-else :data-doc-value="of"
    ><slot>{{ known?.fallback ?? of }}</slot></span
  >
</template>

<style scoped>
.doc-value {
  overflow-wrap: anywhere;
}
</style>
