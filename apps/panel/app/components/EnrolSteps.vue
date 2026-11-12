<script setup lang="ts">
/**
 * The steps shared by first-time setup and joining through an invite: name, passkey,
 * recovery codes, then typing one back to prove they were saved.
 */
const props = defineProps<{
  /** Heading for the passkey step. */
  heading: string
  /** Joining needs a name; at setup it's optional. */
  nameRequired?: boolean
  finishLabel: string
}>()
const emit = defineEmits<{ done: [] }>()

const { refresh } = useAuthState()
const { register } = usePasskeys()

const step = ref<'passkey' | 'codes' | 'confirm'>('passkey')
const busy = ref(false)
const error = ref('')
const name = ref('')
const codes = ref<string[]>([])
const confirmCode = ref('')

async function run(fn: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

const createPasskey = () =>
  run(async () => {
    const res = await register(name.value.trim() || undefined)
    codes.value = res.recoveryCodes ?? []
    step.value = 'codes'
  })

function downloadCodes() {
  const text = `Flytower recovery codes for ${location.host}\nEach code works once.\n\n${codes.value.join('\n')}\n`
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: 'flytower-recovery-codes.txt',
  })
  a.click()
  URL.revokeObjectURL(url)
}

const copy = useCopy()
const copyCodes = () => copy(codes.value.join('\n'), 'Codes')

const confirm = () =>
  run(async () => {
    await $fetch('/api/setup/confirm', { method: 'POST', body: { code: confirmCode.value } })
    await refresh()
    emit('done')
  })
</script>

<template>
  <div>
    <template v-if="step === 'passkey'">
      <h1 class="text-lg font-semibold">{{ props.heading }}</h1>
      <slot />
      <p class="mt-1 text-sm text-muted">
        You'll sign in with this passkey instead of a password. Your device will ask for your
        fingerprint, face or PIN.
      </p>
      <UForm :state="{ name }" class="mt-6 space-y-4" @submit="createPasskey">
        <UFormField
          label="Your name"
          name="name"
          :hint="props.nameRequired ? undefined : 'Optional'"
          :required="props.nameRequired"
        >
          <UInput v-model="name" autocomplete="name" class="w-full" />
        </UFormField>
        <UButton
          type="submit"
          block
          :loading="busy"
          :disabled="props.nameRequired && !name.trim()"
          icon="i-lucide-fingerprint"
          label="Create passkey"
        />
      </UForm>
    </template>

    <template v-else-if="step === 'codes'">
      <h1 class="text-lg font-semibold">Save your recovery codes</h1>
      <p class="mt-1 text-sm text-muted">
        If you lose every passkey, one of these codes gets you back in. Each code works once. This
        is the only time they're shown.
      </p>
      <ol class="mt-4 grid grid-cols-2 gap-2 rounded-md bg-elevated p-4 font-mono text-sm">
        <li v-for="c in codes" :key="c">{{ c }}</li>
      </ol>
      <div class="mt-4 flex gap-2">
        <UButton
          variant="outline"
          icon="i-lucide-download"
          label="Download"
          @click="downloadCodes"
        />
        <UButton variant="outline" icon="i-lucide-copy" label="Copy" @click="copyCodes" />
      </div>
      <UButton class="mt-6" block label="I've saved them" @click="step = 'confirm'" />
    </template>

    <template v-else>
      <h1 class="text-lg font-semibold">Check you've saved them</h1>
      <p class="mt-1 text-sm text-muted">Type any one of your recovery codes.</p>
      <UForm :state="{ confirmCode }" class="mt-6 space-y-4" @submit="confirm">
        <UFormField label="Recovery code" name="confirmCode">
          <UInput v-model="confirmCode" autocomplete="off" autofocus class="w-full font-mono" />
        </UFormField>
        <UButton
          type="submit"
          block
          :loading="busy"
          :disabled="!confirmCode"
          :label="props.finishLabel"
        />
        <UButton variant="link" block label="Show the codes again" @click="step = 'codes'" />
      </UForm>
    </template>

    <UAlert v-if="error" class="mt-4" color="error" variant="subtle" :title="error" />
  </div>
</template>
