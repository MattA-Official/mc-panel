<script setup lang="ts">
const site = useAppConfig().site
const copied = ref(false)
async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}
</script>

<template>
  <div
    class="flex w-full max-w-3xl items-center gap-2 rounded-md border border-default bg-elevated px-3 py-2 font-mono text-sm"
  >
    <span class="select-none text-primary">$</span>
    <code class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-left">{{
      site.install
    }}</code>
    <UButton
      :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
      color="neutral"
      variant="ghost"
      size="sm"
      :aria-label="copied ? 'Copied' : 'Copy install command'"
      @click="copy(site.install)"
    />
  </div>
</template>
