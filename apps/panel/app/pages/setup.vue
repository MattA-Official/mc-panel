<script setup lang="ts">
definePageMeta({ layout: 'centered' })
useHead({ title: 'Set up' })

const { state } = useAuthState()
const step = ref<'token' | 'enrol'>(state.value?.setupVerified ? 'enrol' : 'token')
const busy = ref(false)
const error = ref('')
const token = ref('')

async function submitToken() {
  busy.value = true
  error.value = ''
  try {
    await $fetch('/api/setup/token', { method: 'POST', body: { token: token.value } })
    step.value = 'enrol'
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

// The installer's setup link carries the token after `#`, so opening it skips typing.
onMounted(() => {
  const fromLink = takeLinkToken()
  if (fromLink && step.value === 'token') {
    token.value = fromLink
    void submitToken()
  }
})
</script>

<template>
  <UCard>
    <template v-if="step === 'token'">
      <h1 class="text-lg font-semibold">Set up Flytower</h1>
      <p class="mt-1 text-sm text-muted">
        Open the setup link the installer printed, or enter the setup token it showed.
      </p>
      <UForm :state="{ token }" class="mt-6 space-y-4" @submit="submitToken">
        <UFormField label="Setup token" name="token">
          <UInput v-model="token" autocomplete="off" autofocus class="w-full font-mono" />
        </UFormField>
        <UButton type="submit" block :loading="busy" :disabled="!token" label="Continue" />
      </UForm>
      <UAlert v-if="error" class="mt-4" color="error" variant="subtle" :title="error" />
    </template>

    <EnrolSteps
      v-else
      heading="Create your passkey"
      finish-label="Finish setup"
      @done="navigateTo('/')"
    />
  </UCard>
</template>
