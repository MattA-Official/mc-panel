<script setup lang="ts">
/** Settings kept in this browser only, not on the account. */
const rightClick = useRightClickMenus()
</script>

<template>
  <UCard data-e2e="account-browser">
    <h2 class="text-base font-semibold">This browser</h2>
    <p class="mt-1 text-sm text-muted">Only for this browser, so each device can differ.</p>
    <div class="mt-4">
      <USwitch
        :model-value="rightClick.enabled.value"
        label="Use Flytower's right-click menus"
        description="Right-click a server card for its actions. Shift + right-click always shows the browser's menu, and the ⋯ buttons work either way."
        data-e2e="right-click-switch"
        @update:model-value="rightClick.set"
      />
    </div>
  </UCard>
</template>
