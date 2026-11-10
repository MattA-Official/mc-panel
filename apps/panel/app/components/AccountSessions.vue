<script setup lang="ts">
/** Signing out everywhere else, for a lost or shared device. */
const toast = useToast()
const withElevation = useElevation()
const confirming = ref(false)
const busy = ref(false)

async function signOutEverywhere() {
  busy.value = true
  try {
    await withElevation(() =>
      $fetch<unknown>('/api/account/sign-out-everywhere' as string, { method: 'POST' }),
    )
    confirming.value = false
    toast.add({ title: 'Signed out everywhere else', color: 'success' })
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UCard>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 class="text-base font-semibold">Signed-in devices</h2>
        <p class="mt-1 text-sm text-muted">
          Lost a phone or signed in on a shared computer? Sign out everywhere except here.
        </p>
      </div>
      <UButton
        label="Sign out everywhere else"
        icon="i-lucide-log-out"
        color="neutral"
        variant="outline"
        class="shrink-0 self-start sm:self-center"
        data-e2e="sign-out-everywhere"
        @click="confirming = true"
      />
    </div>
    <UModal v-model:open="confirming" title="Sign out everywhere else?">
      <template #body>
        <p class="text-sm">
          Every other browser and device signed in as you is signed out on its next click. This one
          stays signed in. You're asked for your passkey.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="confirming = false" />
          <UButton label="Sign out everywhere else" :loading="busy" @click="signOutEverywhere" />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
