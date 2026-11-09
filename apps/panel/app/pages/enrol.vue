<script setup lang="ts">
definePageMeta({ layout: 'centered' })
useHead({ title: 'Add a passkey' })

const { refresh } = useAuthState()
const { register } = usePasskeys()
const busy = ref(false)
const error = ref('')

async function add() {
  busy.value = true
  error.value = ''
  try {
    await register()
    await refresh()
    await navigateTo('/')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UCard>
    <h1 class="text-lg font-semibold">Add a new passkey</h1>
    <p class="mt-1 text-sm text-muted">
      You signed in with a recovery code. Add a passkey on this device before carrying on.
    </p>
    <UButton
      class="mt-6"
      block
      size="lg"
      icon="i-lucide-fingerprint"
      label="Add passkey"
      :loading="busy"
      @click="add"
    />
    <UAlert v-if="error" class="mt-4" color="error" variant="subtle" :title="error" />
  </UCard>
</template>
