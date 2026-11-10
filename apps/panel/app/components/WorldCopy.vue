<script setup lang="ts">
/** Brings another server's world over this one's. */
const { server } = useServerContext()
const withElevation = useElevation()
const toast = useToast()
const { data: servers } = await useFetch<Server[]>('/api/servers', { default: () => [] })
const others = computed(() =>
  servers.value
    .filter((s) => s.name !== server.value?.name)
    .map((s) => ({ label: s.displayName, value: s.name })),
)

const open = ref(false)
const from = ref('')
const typed = ref('')
const starting = ref(false)
const job = ref<number | null>(null)
const finished = ref<JobEvent | null>(null)
const fromName = computed(() => others.value.find((o) => o.value === from.value)?.label ?? '')

function begin() {
  from.value = others.value[0]?.value ?? ''
  typed.value = ''
  job.value = null
  finished.value = null
  open.value = true
}

async function copy() {
  if (!server.value) return
  const name = server.value.name
  starting.value = true
  try {
    const r = await withElevation(() =>
      $fetch<{ jobId: number }>(`/api/servers/${name}/world/copy` as string, {
        method: 'POST',
        body: { from: from.value },
      }),
    )
    job.value = r.jobId
  } catch (err) {
    toast.add({ title: "Couldn't copy the world", description: errorMessage(err), color: 'error' })
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <section v-if="server" class="rounded-lg border border-default p-5">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 class="text-base font-semibold">Copy a world in</h2>
        <p class="mt-1 max-w-lg text-sm text-muted">
          Replaces this server's world with a copy of another server's. A backup is taken first, and
          this server keeps its own datapacks. To copy into a new server, use Clone in Settings.
        </p>
      </div>
      <UButton
        label="Copy a world in"
        icon="i-lucide-import"
        color="neutral"
        variant="outline"
        :disabled="!others.length"
        @click="begin"
      />
    </div>

    <UModal
      v-model:open="open"
      :title="`Copy a world into ${server.displayName}`"
      :dismissible="!job || !!finished"
    >
      <template #body>
        <JobProgress
          v-if="job"
          :job-id="job"
          :steps="WORLD_COPY_STEPS"
          success-title="World copied"
          @finished="finished = $event"
        />
        <div v-else class="space-y-4">
          <UFormField label="Copy the world from">
            <USelect v-model="from" :items="others" class="w-full" />
          </UFormField>
          <p class="text-sm text-muted">
            {{ fromName }} can stay running. {{ server.displayName }} is restarted, and its current
            world is kept in Backups.
          </p>
          <UFormField :label="`Type ${server.name} to confirm`">
            <UInput v-model="typed" class="w-full font-mono" autocomplete="off" />
          </UFormField>
          <p class="text-xs text-muted">You'll be asked for your passkey.</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <template v-if="!job">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
            <UButton
              label="Copy world"
              color="error"
              icon="i-lucide-import"
              :disabled="!from || typed !== server.name"
              :loading="starting"
              data-e2e="confirm-copy"
              @click="copy"
            />
          </template>
          <UButton
            v-else-if="finished"
            label="Done"
            color="neutral"
            variant="outline"
            @click="open = false"
          />
        </div>
      </template>
    </UModal>
  </section>
</template>
