<script setup lang="ts">
/** Settings kept in this browser only, not on the account. */
const rightClick = useRightClickMenus()
const shortcuts = useKeyboardShortcuts()
const sheet = useShortcutSheet()
</script>

<template>
  <UCard data-e2e="account-browser">
    <h2 class="text-base font-semibold">This browser</h2>
    <p class="mt-1 text-sm text-muted">Only for this browser, so each device can differ.</p>
    <div class="mt-4 space-y-4">
      <USwitch
        :model-value="rightClick.enabled.value"
        label="Use Flytower's right-click menus"
        description="Right-click a server card for its actions. Shift + right-click always shows the browser's menu, and the ⋯ buttons work either way."
        data-e2e="right-click-switch"
        @update:model-value="rightClick.set"
      />
      <USwitch
        :model-value="shortcuts.enabled.value"
        label="Use single-key shortcuts"
        description="Keys like G then S for Servers, J and K to move through a list, and ? to list them all. Ctrl + K and Ctrl + S work either way."
        data-e2e="shortcuts-switch"
        @update:model-value="shortcuts.set"
      />
      <UButton
        label="See all shortcuts"
        icon="i-lucide-keyboard"
        color="neutral"
        variant="link"
        class="px-0"
        @click="sheet = true"
      />
    </div>
  </UCard>
</template>
