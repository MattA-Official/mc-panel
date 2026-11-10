<script setup lang="ts">
definePageMeta({ layout: 'centered' })
useHead({ title: 'Join' })

interface Invite {
  role: string
  server: string | null
  invitedBy: string | null
  expiresAt: string
}

const invite = ref<Invite | null>(null)
const error = ref('')
const loading = ref(true)

onMounted(async () => {
  const token = takeLinkToken()
  if (!token) {
    error.value = 'This page needs the whole invite link. Open the link you were sent again.'
    loading.value = false
    return
  }
  try {
    invite.value = await $fetch<Invite>('/api/join', { method: 'POST', body: { token } })
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
})

const where = computed(() =>
  invite.value?.server ? `the ${invite.value.server} server` : 'every server',
)
</script>

<template>
  <UCard>
    <div v-if="loading" class="py-6 text-center text-sm text-muted">Checking your invite…</div>

    <template v-else-if="error">
      <h1 class="text-lg font-semibold">This invite can't be used</h1>
      <p class="mt-1 text-sm text-muted">{{ error }}</p>
      <UButton class="mt-6" block variant="outline" to="/login" label="Go to sign in" />
    </template>

    <EnrolSteps
      v-else-if="invite"
      heading="Join Flytower"
      name-required
      finish-label="Finish"
      @done="navigateTo('/')"
    >
      <p class="mt-1 text-sm" data-e2e="invite-summary">
        <template v-if="invite.invitedBy">{{ invite.invitedBy }} invited you</template>
        <template v-else>You've been invited</template>
        as <strong>{{ invite.role }}</strong> on {{ where }}.
      </p>
    </EnrolSteps>
  </UCard>
</template>
