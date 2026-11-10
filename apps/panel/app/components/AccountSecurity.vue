<script setup lang="ts">
/** Your passkeys (add, remove) and recovery codes (how many are left, make a new set). */
interface Account {
  name: string
  passkeys: { id: string; nickname: string; createdAt: string; lastUsedAt: string | null }[]
  recoveryCodesLeft: number
}
const toast = useToast()
const withElevation = useElevation()
const { register } = usePasskeys()
const { data: account, error, refresh } = await useFetch<Account>('/api/account')

const busy = ref(false)
async function run(action: () => Promise<unknown>, done: string) {
  busy.value = true
  try {
    await withElevation(action)
    toast.add({ title: done, color: 'success' })
    await refresh()
  } catch (err) {
    if ((err as Error)?.name === 'NotAllowedError') return
    toast.add({ title: "That didn't work", description: errorMessage(err), color: 'error' })
  } finally {
    busy.value = false
  }
}

const add = () => run(() => register(), 'Passkey added')

const removing = ref<Account['passkeys'][number] | null>(null)
// Kept while the dialog fades out, so its title doesn't go blank.
const removingName = ref('')
watch(removing, (p) => p && (removingName.value = p.nickname))
async function remove() {
  const p = removing.value
  if (!p) return
  await run(
    () =>
      $fetch<unknown>(`/api/passkeys/${encodeURIComponent(p.id)}` as string, { method: 'DELETE' }),
    `Removed ${p.nickname}`,
  )
  removing.value = null
}

const codes = ref<string[] | null>(null)
const confirmingCodes = ref(false)
async function newCodes() {
  confirmingCodes.value = false
  await run(async () => {
    const res = await $fetch<{ codes: string[] }>('/api/account/recovery-codes', {
      method: 'POST',
    })
    codes.value = res.codes
  }, 'New recovery codes made')
}
function downloadCodes() {
  if (!codes.value) return
  const text = `Flytower recovery codes for ${location.host}\nEach code works once.\n\n${codes.value.join('\n')}\n`
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  Object.assign(document.createElement('a'), {
    href: url,
    download: 'flytower-recovery-codes.txt',
  }).click()
  URL.revokeObjectURL(url)
}

const day = (iso: string) => formatDate(iso)
</script>

<template>
  <UCard data-e2e="account-security">
    <template #header>
      <h2 class="font-semibold">Your passkeys</h2>
    </template>
    <UAlert v-if="error" color="error" variant="subtle" :title="errorMessage(error)" />
    <template v-else-if="account">
      <p class="text-sm text-muted">
        Add a passkey on a second device (or a security key) so losing one device doesn't lock you
        out.
      </p>
      <ul class="mt-3 divide-y divide-default rounded-md border border-default">
        <li
          v-for="p in account.passkeys"
          :key="p.id"
          class="flex items-center justify-between gap-3 px-3 py-2"
        >
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">{{ p.nickname }}</p>
            <p class="text-xs text-muted">
              Added {{ day(p.createdAt) }}
              <template v-if="p.lastUsedAt"> · last used {{ day(p.lastUsedAt) }}</template>
            </p>
          </div>
          <UButton
            v-if="account.passkeys.length > 1"
            size="sm"
            color="neutral"
            variant="ghost"
            icon="i-lucide-trash-2"
            :aria-label="`Remove ${p.nickname}`"
            @click="removing = p"
          />
        </li>
      </ul>
      <UButton
        class="mt-3"
        icon="i-lucide-plus"
        label="Add a passkey"
        variant="outline"
        :loading="busy"
        @click="add"
      />

      <USeparator class="my-5" />
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold">Recovery codes</h3>
          <p class="text-sm text-muted">
            {{ account.recoveryCodesLeft }} of 10 unused.
            <template v-if="account.recoveryCodesLeft <= 3">Make a new set soon.</template>
          </p>
        </div>
        <UButton
          label="Make new codes"
          variant="outline"
          color="neutral"
          :loading="busy"
          @click="confirmingCodes = true"
        />
      </div>
      <div v-if="codes" class="mt-4" data-e2e="new-codes">
        <p class="text-sm text-muted">
          Save these now. This is the only time they're shown, and your old codes no longer work.
        </p>
        <ol class="mt-2 grid grid-cols-2 gap-2 rounded-md bg-elevated p-4 font-mono text-sm">
          <li v-for="c in codes" :key="c">{{ c }}</li>
        </ol>
        <div class="mt-3 flex gap-2">
          <UButton
            variant="outline"
            icon="i-lucide-download"
            label="Download"
            @click="downloadCodes"
          />
          <UButton variant="ghost" color="neutral" label="Done" @click="codes = null" />
        </div>
      </div>
    </template>

    <UModal
      :open="!!removing"
      :title="`Remove ${removingName}?`"
      description="That device won't be able to sign in any more."
      @update:open="(v) => !v && (removing = null)"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="removing = null" />
          <UButton color="error" label="Remove" :loading="busy" @click="remove" />
        </div>
      </template>
    </UModal>
    <UModal
      v-model:open="confirmingCodes"
      title="Make new recovery codes?"
      description="Your current codes stop working straight away."
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancel"
            @click="confirmingCodes = false"
          />
          <UButton label="Make new codes" :loading="busy" @click="newCodes" />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
