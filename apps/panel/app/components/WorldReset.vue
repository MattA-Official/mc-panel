<script setup lang="ts">
/** Throws the world away for a new one, after a backup. */
const { server } = useServerContext()
const withElevation = useElevation()
const toast = useToast()

const open = ref(false)
const seedMode = ref<'keep' | 'random' | 'seed'>('random')
const seed = ref('')
const typed = ref('')
const starting = ref(false)
const job = ref<number | null>(null)
const finished = ref<JobEvent | null>(null)

function begin() {
  seedMode.value = 'random'
  seed.value = ''
  typed.value = ''
  job.value = null
  finished.value = null
  open.value = true
}

const canReset = computed(
  () =>
    typed.value === server.value?.name && (seedMode.value !== 'seed' || seed.value.trim() !== ''),
)

async function reset() {
  if (!server.value) return
  const name = server.value.name
  starting.value = true
  try {
    const body =
      seedMode.value === 'keep'
        ? { keep: true }
        : seedMode.value === 'random'
          ? { random: true }
          : { seed: seed.value.trim() }
    const r = await withElevation(() =>
      $fetch<{ jobId: number }>(`/api/servers/${name}/world/reset` as string, {
        method: 'POST',
        body,
      }),
    )
    job.value = r.jobId
  } catch (err) {
    toast.add({ title: "Couldn't reset the world", description: errorMessage(err), color: 'error' })
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div v-if="server">
    <section class="rounded-lg border border-error/40 p-5">
      <h2 class="text-base font-semibold text-error">Reset the world</h2>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-4">
        <p class="max-w-lg text-sm text-muted">
          Starts a brand new world. A backup is taken first, so the old one can come back from
          Backups. Installed datapacks stay.
        </p>
        <UButton
          label="Reset world"
          color="error"
          variant="soft"
          icon="i-lucide-refresh-ccw"
          @click="begin"
        />
      </div>
    </section>

    <UModal
      v-model:open="open"
      :title="`Reset ${server.displayName}'s world?`"
      :dismissible="!job || !!finished"
    >
      <template #body>
        <JobProgress
          v-if="job"
          :job-id="job"
          :steps="WORLD_RESET_STEPS"
          success-title="World reset"
          @finished="finished = $event"
        />
        <div v-else class="space-y-4">
          <URadioGroup
            v-model="seedMode"
            legend="Seed"
            :items="[
              { label: 'A new random seed', value: 'random' },
              { label: 'The same seed (same terrain, fresh chunks)', value: 'keep' },
              { label: 'A seed I choose', value: 'seed' },
            ]"
          />
          <UInput
            v-if="seedMode === 'seed'"
            v-model="seed"
            placeholder="Seed"
            class="w-full font-mono"
            :maxlength="64"
          />
          <UFormField :label="`Type ${server.name} to confirm`">
            <UInput v-model="typed" class="w-full font-mono" autocomplete="off" />
          </UFormField>
          <p class="text-xs text-muted">
            Players are disconnected while it resets. You'll be asked for your passkey.
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <template v-if="!job">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
            <UButton
              label="Reset world"
              color="error"
              icon="i-lucide-refresh-ccw"
              :disabled="!canReset"
              :loading="starting"
              data-e2e="confirm-reset"
              @click="reset"
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
  </div>
</template>
