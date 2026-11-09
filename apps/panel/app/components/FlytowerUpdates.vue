<script setup lang="ts">
/** Updating Flytower itself, and going back. Minecraft servers keep running throughout. */
interface Status {
  current: string
  channel: 'stable' | 'beta'
  installed: string[]
  last: {
    state: 'running' | 'succeeded' | 'rolled-back' | 'failed'
    from: string
    to: string
    reason: string | null
    at: string
    manual: boolean
  } | null
  latest: {
    version: string
    notes: string
    url: string
    publishedAt: string
    prerelease: boolean
  } | null
  checkError: string | null
}

const withElevation = useElevation()
const toast = useToast()
const { data, refresh } = await useFetch<Status>('/api/system/updates')
const checking = ref(false)
const working = ref<string | null>(null)

async function check() {
  checking.value = true
  try {
    data.value = await $fetch<Status>('/api/system/updates', { query: { check: true } })
  } finally {
    checking.value = false
  }
}

const channels = [
  { value: 'stable', label: 'Stable', description: 'Only finished releases.' },
  {
    value: 'beta',
    label: 'Beta',
    description: 'Also betas, to try new features early. They may have rough edges.',
  },
]
const savingChannel = ref(false)

async function setChannel(channel: Status['channel']) {
  if (!data.value || channel === data.value.channel) return
  savingChannel.value = true
  try {
    await $fetch('/api/system/updates/channel', { method: 'PUT', body: { channel } })
    data.value = await $fetch<Status>('/api/system/updates', { query: { check: true } })
  } catch (err) {
    toast.add({
      title: "Couldn't change the channel",
      description: errorMessage(err),
      color: 'error',
    })
  } finally {
    savingChannel.value = false
  }
}

/** Running a beta with Stable chosen: nothing is offered until a newer stable release. */
const onBetaStable = computed(
  () => data.value?.channel === 'stable' && data.value.current.includes('-'),
)

const previous = computed(() =>
  (data.value?.installed ?? []).filter((v) => v !== data.value?.current).at(-1),
)

/** The panel restarts during an update; wait for it to come back, then reload. */
async function follow(target: string) {
  const deadline = Date.now() + 4 * 60_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000))
    const s = await $fetch<Status>('/api/system/updates').catch(() => null)
    if (!s?.last || s.last.to !== target || s.last.state === 'running') continue
    if (s.last.state === 'succeeded') {
      toast.add({ title: `Flytower ${target} is running`, color: 'success' })
      window.location.reload()
      return
    }
    data.value = s
    toast.add({
      title: s.last.state === 'rolled-back' ? 'Update rolled back' : 'Update failed',
      description: s.last.reason ?? undefined,
      color: 'error',
    })
    return
  }
  toast.add({ title: 'Still updating', description: 'Check back in a minute.', color: 'warning' })
}

async function install(version: string, rollback = false) {
  working.value = version
  try {
    await withElevation(() =>
      $fetch<{ started: boolean }>('/api/system/updates' as string, {
        method: 'POST',
        body: { version, rollback },
      }),
    )
    await follow(version)
  } catch (err) {
    toast.add({ title: "Couldn't update", description: errorMessage(err), color: 'error' })
  } finally {
    working.value = null
    await refresh().catch(() => {})
  }
}

const when = (at: string) =>
  new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
</script>

<template>
  <UCard v-if="data" class="max-w-xl" data-e2e="updates">
    <div class="space-y-4 text-sm">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="font-medium">Flytower {{ data.current }}</p>
          <p class="text-muted">
            {{ data.latest ? `${data.latest.version} is available.` : 'Up to date.' }}
          </p>
        </div>
        <UButton
          label="Check now"
          icon="i-lucide-refresh-cw"
          size="sm"
          color="neutral"
          variant="outline"
          :loading="checking"
          @click="check"
        />
      </div>
      <p v-if="data.checkError" class="text-warning">{{ data.checkError }}</p>

      <URadioGroup
        :model-value="data.channel"
        :items="channels"
        legend="Update channel"
        orientation="horizontal"
        variant="card"
        :disabled="savingChannel || !!working"
        data-e2e="update-channel"
        @update:model-value="(v) => setChannel(v as Status['channel'])"
      />
      <p v-if="onBetaStable" class="text-xs text-muted">
        You're running a beta. Flytower will offer the next stable release that's newer than it; to
        leave the beta sooner, go back to the version you had before.
      </p>

      <div v-if="data.latest" class="space-y-3 rounded-md border border-default p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <ULink :to="data.latest.url" target="_blank" class="font-medium text-primary">
              What's new in {{ data.latest.version }}
            </ULink>
            <UBadge v-if="data.latest.prerelease" label="Beta" color="warning" variant="subtle" />
          </div>
          <UButton
            :label="`Update to ${data.latest.version}`"
            icon="i-lucide-arrow-up-circle"
            :loading="working === data.latest.version"
            :disabled="!!working"
            @click="install(data.latest.version)"
          />
        </div>
        <pre class="max-h-48 overflow-auto whitespace-pre-wrap text-xs text-muted">{{
          data.latest.notes
        }}</pre>
        <p v-if="data.latest.prerelease" class="text-xs text-warning">
          This is a beta, for trying new features before they're released. Take a backup of anything
          you care about first; you can go back afterwards.
        </p>
        <p class="text-xs text-muted">
          Minecraft servers keep running. The panel restarts and comes back in under a minute; if
          the new version doesn't start properly, Flytower goes back by itself.
        </p>
      </div>

      <UAlert
        v-if="data.last && data.last.state !== 'succeeded' && data.last.state !== 'running'"
        color="warning"
        variant="subtle"
        icon="i-lucide-undo-2"
        :title="`Updating to ${data.last.to} ${data.last.state === 'rolled-back' ? 'was rolled back' : 'failed'}`"
        :description="`${data.last.reason ?? ''} (${when(data.last.at)})`"
      />

      <div v-if="previous" class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-muted">{{ previous }} is still installed, if you need to go back.</p>
        <UButton
          :label="`Go back to ${previous}`"
          size="sm"
          color="neutral"
          variant="ghost"
          :loading="working === previous"
          :disabled="!!working"
          @click="install(previous, true)"
        />
      </div>
      <p class="text-xs text-muted">Updating asks for your passkey.</p>
    </div>
  </UCard>
</template>
