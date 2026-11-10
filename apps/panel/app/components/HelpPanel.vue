<script setup lang="ts">
// The help panel: a docs page beside whatever you're doing, with a way to open it full-page.
const { open, target, show, fullPage } = useHelp()
const body = ref<HTMLElement | null>(null)

const { data: page, status } = useAsyncData(
  'help-panel',
  () =>
    target.value ? queryCollection('docs').path(target.value.path).first() : Promise.resolve(null),
  { watch: [() => target.value?.path], immediate: false },
)
watch(open, (isOpen) => {
  if (isOpen && !page.value) void refreshNuxtData('help-panel')
})

// Links between docs pages stay in the panel.
provide('docsOpenInPlace', (to: string) => show(to))

// Scroll to the heading a "Learn more" link asked for, or back to the top. The page's
// components render a moment after its data arrives, so look for the heading for up to a second.
watch(
  [page, () => target.value?.hash, open],
  async () => {
    if (!open.value) return
    const hash = target.value?.hash
    for (let tries = 0; tries < 20; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      const el = hash ? body.value?.querySelector(`[id="${CSS.escape(hash)}"]`) : null
      if (el) return el.scrollIntoView({ block: 'start' })
      if (!hash && body.value?.querySelector('h1')) break
    }
    body.value?.closest('[data-slot="body"]')?.scrollTo({ top: 0 })
  },
  { flush: 'post' },
)
</script>

<template>
  <USlideover v-model:open="open" :ui="{ content: 'sm:max-w-xl' }" data-e2e="help-panel">
    <template #title>
      <span class="flex items-center gap-2">
        <UIcon name="i-lucide-circle-help" class="size-5 text-primary" />Help
      </span>
    </template>
    <template #actions>
      <UButton
        :to="fullPage"
        label="Open full page"
        icon="i-lucide-maximize-2"
        color="neutral"
        variant="ghost"
        size="sm"
        @click="open = false"
      />
    </template>
    <template #body>
      <div ref="body">
        <div v-if="status === 'pending' && !page" class="space-y-3">
          <USkeleton class="h-8 w-2/3" />
          <USkeleton class="h-4 w-full" />
          <USkeleton class="h-4 w-5/6" />
        </div>
        <ContentRenderer v-else-if="page" :value="page" class="help-prose" />
        <UEmpty
          v-else
          icon="i-lucide-file-question"
          title="That help page isn't here"
          description="It may have moved in this version."
        />
      </div>
    </template>
  </USlideover>
</template>
