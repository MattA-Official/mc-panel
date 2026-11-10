<script setup lang="ts">
// "Learn more" beside a setting: opens a docs page (and heading) in the help panel.
// `to` is a docs file and heading, e.g. "backups#off-site-copies".
defineProps<{ to: string }>()
const help = useHelp()
</script>

<template>
  <button
    type="button"
    class="inline font-medium text-primary underline-offset-4 hover:underline"
    :data-help="to"
    @click.prevent="help.show(to)"
  >
    <slot>Learn more</slot>
  </button>
</template>
