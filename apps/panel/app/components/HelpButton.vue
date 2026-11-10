<script setup lang="ts">
// Opens the docs page for the screen you're on, beside it.
const help = useHelp()
</script>

<template>
  <UTooltip text="Help for this page">
    <UButton
      icon="i-lucide-circle-help"
      color="neutral"
      variant="ghost"
      aria-label="Help for this page"
      data-e2e="help-button"
      @click="help.showForRoute()"
    />
  </UTooltip>
</template>
