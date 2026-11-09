<script setup lang="ts">
definePageMeta({ layout: 'centered' })
useHead({ title: 'Sign in' })

const { refresh } = useAuthState()
const { authenticate } = usePasskeys()

const mode = ref<'passkey' | 'recovery'>('passkey')
const code = ref('')
const busy = ref(false)
const error = ref('')

async function run(fn: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await fn()
    await refresh()
    await navigateTo('/')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

const signIn = () => run(() => authenticate('login'))
const useCode = () =>
  run(async () => {
    await $fetch('/api/auth/recovery', { method: 'POST', body: { code: code.value } })
  })
</script>

<template>
  <UCard>
    <template v-if="mode === 'passkey'">
      <h1 class="text-lg font-semibold">Sign in</h1>
      <p class="mt-1 text-sm text-muted">Use the passkey you set up for this panel.</p>
      <UButton
        class="mt-6"
        block
        size="lg"
        icon="i-lucide-fingerprint"
        label="Sign in with passkey"
        :loading="busy"
        @click="signIn"
      />
      <UButton
        class="mt-2"
        variant="link"
        block
        label="Lost your passkeys? Use a recovery code"
        @click="mode = 'recovery'"
      />
    </template>

    <template v-else>
      <h1 class="text-lg font-semibold">Use a recovery code</h1>
      <p class="mt-1 text-sm text-muted">
        The code stops working once used. You'll add a new passkey straight after.
      </p>
      <UForm :state="{ code }" class="mt-6 space-y-4" @submit="useCode">
        <UFormField label="Recovery code" name="code">
          <UInput v-model="code" autocomplete="off" autofocus class="w-full font-mono" />
        </UFormField>
        <UButton type="submit" block :loading="busy" :disabled="!code" label="Continue" />
        <UButton variant="link" block label="Back to passkey sign-in" @click="mode = 'passkey'" />
      </UForm>
    </template>

    <UAlert v-if="error" class="mt-4" color="error" variant="subtle" :title="error" />
  </UCard>
</template>
