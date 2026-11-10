<script setup lang="ts">
/** The `?` sheet (#108): every keyboard shortcut, grouped, from the shared list. */
const open = useShortcutSheet()
const { enabled } = useKeyboardShortcuts()
/** Ctrl reads as ⌘ on a Mac: UKbd's `meta` does that. */
const key = (k: string) => (k === 'Ctrl' ? 'meta' : k)
</script>

<template>
  <UModal
    v-model:open="open"
    title="Keyboard shortcuts"
    description="They don't fire while you're typing in a field, the console or an editor."
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <UAlert
        v-if="!enabled"
        class="mb-4"
        color="neutral"
        variant="subtle"
        icon="i-lucide-keyboard-off"
        title="Single-key shortcuts are off in this browser"
        description="Ctrl + K still works. Turn them back on under This browser on Your account."
      />
      <div class="grid gap-6 sm:grid-cols-2" data-e2e="shortcut-sheet">
        <section v-for="group in SHEET" :key="group.title">
          <h3 class="mb-2 text-sm font-semibold">{{ group.title }}</h3>
          <dl class="space-y-1.5">
            <div
              v-for="item in group.items"
              :key="item.label"
              class="flex items-center justify-between gap-4 text-sm"
            >
              <dt class="text-muted">{{ item.label }}</dt>
              <dd class="flex shrink-0 items-center gap-1">
                <template v-for="(combo, i) in item.kbds" :key="i">
                  <span v-if="i" class="text-xs text-dimmed">or</span>
                  <UKbd v-for="k in combo" :key="k" :value="key(k)" />
                </template>
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </template>
  </UModal>
</template>
