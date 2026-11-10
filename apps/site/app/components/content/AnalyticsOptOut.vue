<script setup lang="ts">
// Used in the Privacy Policy as ::analytics-opt-out. The choice is kept in this browser only.
const ready = ref(false)
const gpc = ref(false)
const enabled = ref(true)

onMounted(() => {
  gpc.value = globalPrivacyControl()
  enabled.value = !gpc.value && !analyticsOptedOut()
  ready.value = true
})

function toggle(value: boolean) {
  enabled.value = value
  setAnalyticsOptOut(!value)
}
</script>

<template>
  <div class="not-prose my-6 rounded-md border border-default p-4">
    <USwitch
      :model-value="enabled"
      :disabled="!ready || gpc"
      label="Count my visits in Flytower's analytics"
      :description="
        gpc
          ? 'Your browser sends Global Privacy Control, so analytics are already off and stay off.'
          : 'Cloudflare Web Analytics, with no cookies. Turning this off stops the analytics script loading in this browser from your next page view.'
      "
      @update:model-value="toggle"
    />
  </div>
</template>
