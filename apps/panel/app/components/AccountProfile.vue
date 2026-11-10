<script setup lang="ts">
/** Your name and how the panel looks for you. */
type Theme = 'system' | 'light' | 'dark'

const toast = useToast()
const { state, refresh } = useAuthState()
const colorMode = useColorMode()
const name = ref(state.value?.user?.name ?? '')
const saving = ref(false)

const themes: { label: string; value: Theme; icon: string }[] = [
  { label: 'Follow this device', value: 'system', icon: 'i-lucide-monitor' },
  { label: 'Light', value: 'light', icon: 'i-lucide-sun' },
  { label: 'Dark', value: 'dark', icon: 'i-lucide-moon' },
]
const theme = computed<Theme>({
  get: () => state.value?.theme ?? 'system',
  set: (value) => void saveTheme(value),
})

async function saveName() {
  saving.value = true
  try {
    await $fetch('/api/account', { method: 'PATCH', body: { name: name.value } })
    await refresh()
    toast.add({ title: 'Name saved', color: 'success' })
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function saveTheme(value: Theme) {
  colorMode.preference = value
  try {
    await $fetch('/api/account', { method: 'PATCH', body: { theme: value } })
    await refresh()
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  }
}
</script>

<template>
  <UCard data-e2e="account-profile">
    <template #header>
      <h2 class="text-base font-semibold">Profile</h2>
      <p class="mt-1 text-sm text-muted">How you show in Activity and on People.</p>
    </template>
    <div class="space-y-6">
      <form class="flex flex-col gap-2 sm:flex-row sm:items-end" @submit.prevent="saveName">
        <UFormField label="Your name" class="w-full sm:max-w-sm">
          <UInput v-model="name" maxlength="60" autocomplete="name" class="w-full" />
        </UFormField>
        <UButton
          type="submit"
          label="Save"
          :loading="saving"
          :disabled="!name.trim() || name.trim() === state?.user?.name"
        />
      </form>
      <UFormField label="Appearance" description="Saved for you, on every device you sign in on.">
        <URadioGroup
          v-model="theme"
          :items="themes"
          orientation="horizontal"
          variant="card"
          class="mt-2"
        />
      </UFormField>
    </div>
  </UCard>
</template>
