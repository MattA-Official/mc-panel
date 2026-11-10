<script setup lang="ts">
/** Starts a new world, after a backup, optionally keeping the old one as a past world. */
const { server } = useServerContext()
const emit = defineEmits<{ reset: [] }>()
const withElevation = useElevation()
const toast = useToast()

const open = ref(false)
const seedMode = ref<'keep' | 'random' | 'seed'>('random')
const seed = ref('')
const typed = ref('')
const keepWorld = ref(true)
const pastName = ref('')
const keepBackup = ref(false)

function defaultName() {
  const month = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  return `${server.value?.displayName ?? 'Old'} world, ${month}`.slice(0, 60)
}
const starting = ref(false)
const job = ref<number | null>(null)
const finished = ref<JobEvent | null>(null)

function begin() {
  seedMode.value = 'random'
  seed.value = ''
  typed.value = ''
  keepWorld.value = true
  pastName.value = defaultName()
  keepBackup.value = false
  job.value = null
  finished.value = null
  open.value = true
}

const canReset = computed(
  () =>
    typed.value === server.value?.name &&
    (seedMode.value !== 'seed' || seed.value.trim() !== '') &&
    (!keepWorld.value || pastName.value.trim() !== ''),
)

function onFinished(e: JobEvent) {
  finished.value = e
  if (e.state === 'succeeded') emit('reset')
}

async function reset() {
  if (!server.value) return
  const name = server.value.name
  starting.value = true
  try {
    const seedChoice =
      seedMode.value === 'keep'
        ? { keep: true }
        : seedMode.value === 'random'
          ? { random: true }
          : { seed: seed.value.trim() }
    const body = {
      ...seedChoice,
      pastWorld: keepWorld.value ? pastName.value.trim() : null,
      keepBackup: keepBackup.value,
    }
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
          Starts a brand new world. A backup is taken first, and the old world can be kept as a past
          world to download, share or start a server from. Installed datapacks stay.
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
          @finished="onFinished"
        />
        <div v-else class="space-y-4">
          <div class="space-y-2">
            <UCheckbox
              v-model="keepWorld"
              label="Keep the old world as a past world"
              description="A zip that opens in singleplayer, listed under Past worlds until you delete it."
              data-e2e="keep-world"
            />
            <UFormField v-if="keepWorld" label="Name" class="pl-6">
              <UInput
                v-model="pastName"
                class="w-full"
                :maxlength="60"
                placeholder="2025–26 world"
                data-e2e="past-world-name"
              />
            </UFormField>
            <UCheckbox
              v-model="keepBackup"
              label="Keep the final backup forever"
              description="The whole server (mods, settings and world) as it is now. Retention never deletes it."
            />
          </div>
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
