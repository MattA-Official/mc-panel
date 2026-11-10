<script setup lang="ts">
/** The visible ⋯ button for a card or row, with the same items as its right-click menu. */
defineProps<{
  items: ActionItem[][]
  /** What the actions are for, e.g. "Survival". */
  label: string
}>()
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'end' }">
    <UButton
      icon="i-lucide-ellipsis-vertical"
      :aria-label="`Actions for ${label}`"
      size="xs"
      color="neutral"
      variant="ghost"
      data-e2e="action-button"
      @click.prevent.stop
    />
  </UDropdownMenu>
</template>
