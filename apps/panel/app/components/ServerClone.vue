<script setup lang="ts">
/** Copies this server to a new one: mods, settings and (optionally) the world. */
const { server } = useServerContext()
const toast = useToast()
const { data: defaults, refresh: refreshDefaults } = await useFetch<{
  maxMemoryMb: number
}>('/api/servers/defaults')

const open = ref(false)
const form = reactive({
  displayName: '',
  name: '',
  memoryMb: 2048,
  withWorld: true,
  acceptEula: false,
})
const starting = ref(false)
const job = ref<number | null>(null)
const finished = ref<JobEvent | null>(null)

const maxMemory = computed(() => Math.max(1024, defaults.value?.maxMemoryMb ?? 1024))

async function begin() {
  if (!server.value) return
  await refreshDefaults()
  form.displayName = `${server.value.displayName} copy`
  form.name = `${server.value.name}-copy`.slice(0, 31)
  form.memoryMb = Math.min(server.value.memoryMb, maxMemory.value)
  form.withWorld = true
  form.acceptEula = false
  job.value = null
  finished.value = null
  open.value = true
}

const NAME_RE = /^[a-z][a-z0-9-]{1,30}$/
const nameError = computed(() =>
  form.name && (!NAME_RE.test(form.name) || form.name.endsWith('-'))
    ? 'Lowercase letters, numbers and hyphens; starts with a letter.'
    : undefined,
)
const canClone = computed(
  () => form.displayName.trim() && form.name && !nameError.value && form.acceptEula,
)

async function clone() {
  if (!server.value) return
  starting.value = true
  try {
    const r = await $fetch<{ jobId: number }>(`/api/servers/${server.value.name}/clone` as string, {
      method: 'POST',
      body: { ...form, displayName: form.displayName.trim() },
    })
    job.value = r.jobId
  } catch (err) {
    toast.add({ title: "Couldn't clone", description: errorMessage(err), color: 'error' })
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <section v-if="server" class="rounded-lg border border-default p-5">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 class="text-base font-semibold">Clone</h2>
        <p class="mt-1 max-w-lg text-sm text-muted">
          A new server with the same mods, datapacks and settings, and a copy of the world if you
          like. Handy for trying something out without touching this one. It's fine while this
          server is running.
        </p>
      </div>
      <UButton
        label="Clone server"
        icon="i-lucide-copy-plus"
        color="neutral"
        variant="outline"
        @click="begin"
      />
    </div>

    <UModal
      v-model:open="open"
      :title="`Clone ${server.displayName}`"
      :dismissible="!job || !!finished"
    >
      <template #body>
        <JobProgress
          v-if="job"
          :job-id="job"
          :steps="CLONE_STEPS"
          success-title="Cloned"
          @finished="finished = $event"
        />
        <div v-else class="space-y-4">
          <UFormField label="Display name">
            <UInput v-model="form.displayName" class="w-full" />
          </UFormField>
          <UFormField label="Folder name" :error="nameError">
            <UInput v-model="form.name" class="w-full font-mono" data-e2e="clone-name" />
          </UFormField>
          <UFormField
            label="Memory"
            :description="`${(form.memoryMb / 1024).toFixed(1)} GB, up to ${(maxMemory / 1024).toFixed(1)} GB free.`"
          >
            <USlider
              v-model="form.memoryMb"
              :min="1024"
              :max="maxMemory"
              :step="512"
              class="mt-2"
            />
          </UFormField>
          <USwitch
            v-model="form.withWorld"
            label="Copy the world too"
            description="Off starts the copy on a new world from the same seed settings."
          />
          <UCheckbox v-model="form.acceptEula">
            <template #label>
              I accept the
              <ULink to="https://aka.ms/MinecraftEULA" target="_blank" class="text-primary"
                >Minecraft EULA</ULink
              >
            </template>
          </UCheckbox>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <template v-if="!job">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
            <UButton
              label="Clone"
              icon="i-lucide-copy-plus"
              :disabled="!canClone"
              :loading="starting"
              data-e2e="confirm-clone"
              @click="clone"
            />
          </template>
          <template v-else-if="finished">
            <UButton label="Close" color="neutral" variant="ghost" @click="open = false" />
            <UButton
              v-if="finished.state === 'succeeded'"
              label="Open the copy"
              :to="`/servers/${form.name}`"
            />
          </template>
        </div>
      </template>
    </UModal>
  </section>
</template>
