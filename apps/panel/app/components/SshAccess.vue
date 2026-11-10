<script setup lang="ts">
interface SshState {
  open: boolean
  ports: number[]
  closesAt: string | null
  firewall: boolean
}
const toast = useToast()
const withElevation = useElevation()
const { data: ssh, error, refresh } = await useFetch<SshState>('/api/system/ssh')

const minutes = ref(60)
const choices = [
  { label: '15 minutes', value: 15 },
  { label: '1 hour', value: 60 },
  { label: '4 hours', value: 240 },
  { label: '24 hours', value: 1440 },
]
const busy = ref(false)
async function set(body: { open: boolean; minutes?: number }, done: string) {
  busy.value = true
  try {
    ssh.value = await withElevation(() =>
      $fetch<SshState>('/api/system/ssh', { method: 'POST', body }),
    )
    toast.add({ title: done, color: 'success' })
  } catch (err) {
    toast.add({ title: "That didn't work", description: errorMessage(err), color: 'error' })
  } finally {
    busy.value = false
  }
}

// Ticks the countdown.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => (timer = setInterval(() => (now.value = Date.now()), 15_000)))
onBeforeUnmount(() => clearInterval(timer))
watch(now, () => {
  if (ssh.value?.closesAt && Date.parse(ssh.value.closesAt) <= now.value) refresh()
})
const left = computed(() => {
  if (!ssh.value?.closesAt) return null
  const m = Math.max(0, Math.round((Date.parse(ssh.value.closesAt) - now.value) / 60_000))
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
})
const ports = computed(() => ssh.value?.ports.join(', ') ?? '22')
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <h2 class="font-semibold">Server access (SSH)</h2>
        <UBadge
          v-if="ssh"
          variant="subtle"
          :color="
            !ssh.firewall
              ? 'warning'
              : ssh.open
                ? ssh.closesAt
                  ? 'warning'
                  : 'neutral'
                : 'success'
          "
          :label="
            !ssh.firewall
              ? 'Firewall off'
              : ssh.open
                ? ssh.closesAt
                  ? `Open, closes in ${left}`
                  : 'Open'
                : 'Closed'
          "
        />
      </div>
    </template>

    <UAlert v-if="error" color="error" variant="subtle" :title="errorMessage(error)" />
    <div v-else-if="ssh" class="space-y-4 text-sm">
      <template v-if="!ssh.firewall">
        <p>
          The firewall (ufw) is off, so SSH on port {{ ports }} is reachable whatever this card
          says. Turn ufw on to manage it here.
        </p>
      </template>
      <template v-else-if="ssh.open && !ssh.closesAt">
        <p>
          SSH on port {{ ports }} is open to the internet. Now Flytower works and you have a
          passkey, you can close it: that removes the most-attacked door on the machine.
        </p>
        <p class="text-muted">
          If Flytower itself ever breaks, you'd get back in through your provider's web console, or
          by opening SSH here for a while.
        </p>
        <UButton
          label="Close SSH"
          icon="i-lucide-lock"
          :loading="busy"
          @click="set({ open: false }, 'SSH closed')"
        />
      </template>
      <template v-else-if="ssh.open">
        <p>
          SSH on port {{ ports }} is open for emergencies. It closes by itself at
          {{ formatTime(ssh.closesAt!) }}, even if the panel restarts.
        </p>
        <div class="flex flex-wrap gap-2">
          <UButton
            label="Close now"
            icon="i-lucide-lock"
            :loading="busy"
            @click="set({ open: false }, 'SSH closed')"
          />
          <UButton
            label="Keep it open"
            color="neutral"
            variant="ghost"
            :disabled="busy"
            @click="set({ open: true }, 'SSH stays open')"
          />
        </div>
      </template>
      <template v-else>
        <p>
          SSH is closed. If you need a shell, open it for a while and it closes again by itself.
        </p>
        <div class="flex flex-wrap items-end gap-2">
          <UFormField label="Open for">
            <USelect v-model="minutes" :items="choices" class="w-36" />
          </UFormField>
          <UButton
            label="Open SSH"
            icon="i-lucide-lock-open"
            color="warning"
            :loading="busy"
            @click="set({ open: true, minutes }, 'SSH opened')"
          />
        </div>
      </template>
    </div>
  </UCard>
</template>
