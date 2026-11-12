<script setup lang="ts">
useHead({ title: 'New server' })

interface Version {
  id: string
  stable: boolean
}

const { data: loaders } = await useFetch<{ id: LoaderId; name: string }[]>('/api/loaders')
const { data: defaults } = await useFetch<{
  port: number
  memoryMb: number
  maxMemoryMb: number
  totalMemoryMb: number
}>('/api/servers/defaults')

const form = reactive({
  displayName: '',
  name: '',
  loader: 'fabric' as LoaderId,
  mcVersion: '',
  loaderVersion: 'latest-stable',
  memoryMb: 4096,
  port: 25565,
  acceptEula: false,
})
watch(
  defaults,
  (d) => {
    if (!d) return
    form.memoryMb = d.memoryMb
    form.port = d.port
  },
  { immediate: true },
)

// The folder/user name follows the display name until it's edited by hand.
const nameTouched = ref(false)
watch(
  () => form.displayName,
  (v) => {
    if (nameTouched.value) return
    form.name = v
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^[^a-z]+/, '')
      .slice(0, 31)
      .replace(/-+$/, '')
  },
)

const snapshots = ref(false)
const {
  data: mcVersions,
  status: mcStatus,
  error: mcError,
} = await useFetch<Version[]>(() => `/api/loaders/${form.loader}/minecraft`, {
  query: { snapshots },
  default: () => [],
})
watch(
  mcVersions,
  (list) => {
    if (!list?.some((v) => v.id === form.mcVersion)) form.mcVersion = list?.[0]?.id ?? ''
  },
  { immediate: true },
)

const { data: loaderVersions } = await useFetch<Version[]>(
  () => `/api/loaders/${form.loader}/versions`,
  {
    query: computed(() => ({ mc: form.mcVersion })),
    default: () => [],
    immediate: false,
    watch: [() => form.mcVersion, () => form.loader],
  },
)
const loaderVersionItems = computed(() => [
  { label: 'Latest stable', value: 'latest-stable' },
  ...(loaderVersions.value ?? []).map((v) => ({
    label: v.stable ? v.id : `${v.id} (beta)`,
    value: v.id,
  })),
])
watch(
  () => [form.loader, form.mcVersion],
  () => (form.loaderVersion = 'latest-stable'),
)

const mcErrorText = computed(() =>
  mcError.value
    ? ((mcError.value.data as { statusMessage?: string } | undefined)?.statusMessage ??
      "Couldn't load versions")
    : undefined,
)

const mcItems = computed(() =>
  (mcVersions.value ?? []).map((v) => ({
    label: v.stable ? v.id : `${v.id} (snapshot)`,
    value: v.id,
  })),
)
const loaderItems = computed(() =>
  (loaders.value ?? []).map((l) => ({
    label: l.name,
    value: l.id,
    description: LOADERS[l.id]?.description ?? '',
  })),
)

const NAME_RE = /^[a-z][a-z0-9-]{1,30}$/
const nameError = computed(() =>
  form.name && (!NAME_RE.test(form.name) || form.name.endsWith('-'))
    ? 'Lowercase letters, numbers and hyphens; starts with a letter.'
    : undefined,
)
const canSubmit = computed(
  () =>
    form.displayName.trim() && form.name && !nameError.value && form.mcVersion && form.acceptEula,
)

const toast = useToast()
const submitting = ref(false)
const jobId = ref<number | null>(null)
const finished = ref<JobEvent | null>(null)

async function submit() {
  submitting.value = true
  try {
    const res = await $fetch<{ jobId: number }>('/api/servers', {
      method: 'POST',
      body: { ...form, displayName: form.displayName.trim() },
    })
    jobId.value = res.jobId
  } catch (err) {
    const e = err as { data?: { statusMessage?: string } }
    toast.add({
      title: "Couldn't create the server",
      description: e.data?.statusMessage ?? 'Something went wrong.',
      color: 'error',
    })
  } finally {
    submitting.value = false
  }
}

function startOver() {
  jobId.value = null
  finished.value = null
}
</script>

<template>
  <UDashboardPanel id="new-server">
    <template #header>
      <UDashboardNavbar title="New server">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" variant="ghost" color="neutral" to="/" />
        </template>
        <template #right><HelpButton /></template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-xl">
        <div v-if="jobId" class="space-y-6">
          <h2 class="font-display text-2xl tracking-wide uppercase">
            Building {{ form.displayName }}
          </h2>
          <JobProgress :job-id="jobId" :steps="CREATE_SERVER_STEPS" @finished="finished = $event" />
          <div v-if="finished" class="flex gap-3">
            <UButton
              v-if="finished.state === 'succeeded'"
              label="Go to server"
              icon="i-lucide-arrow-right"
              trailing
              :to="`/servers/${form.name}`"
            />
            <UButton
              v-else
              label="Change details and try again"
              icon="i-lucide-rotate-ccw"
              @click="startOver"
            />
          </div>
        </div>

        <form v-else class="space-y-6" @submit.prevent="submit">
          <UAlert
            color="neutral"
            variant="subtle"
            icon="i-lucide-folder-input"
            title="Moving a server, or have a spec?"
            description="Import its files or a singleplayer world, or paste a YAML spec, instead of filling this in."
            :actions="[
              {
                label: 'Import a server',
                to: '/servers/import',
                color: 'neutral',
                variant: 'outline',
              },
              {
                label: 'From YAML',
                to: '/servers/from-yaml',
                color: 'neutral',
                variant: 'outline',
              },
            ]"
          />
          <UFormField
            label="Name"
            description="What players and you will call it."
            required
            data-doc="new-server.name"
          >
            <UInput
              v-model="form.displayName"
              placeholder="Survival"
              autofocus
              class="w-full"
              maxlength="60"
            />
          </UFormField>

          <UFormField
            label="Short name"
            description="Used for the folder and system user. It can't change later."
            :error="nameError"
            required
          >
            <UInput
              v-model="form.name"
              class="w-full font-mono"
              placeholder="survival"
              @input="nameTouched = true"
            />
          </UFormField>

          <UFormField label="Loader" data-doc="new-server.loader">
            <URadioGroup
              v-model="form.loader"
              :items="loaderItems"
              orientation="horizontal"
              variant="card"
              :ui="{ fieldset: 'grid gap-2 sm:auto-cols-fr sm:grid-flow-col', item: 'w-full' }"
            />
          </UFormField>

          <div class="grid gap-6 sm:grid-cols-2">
            <div class="space-y-3">
              <UFormField label="Minecraft version" :error="mcErrorText">
                <USelectMenu
                  v-model="form.mcVersion"
                  :items="mcItems"
                  value-key="value"
                  :loading="mcStatus === 'pending'"
                  class="w-full"
                />
              </UFormField>
              <USwitch v-model="snapshots" label="Show snapshots" size="sm" />
            </div>

            <UFormField
              v-if="LOADERS[form.loader].versionLabel"
              :label="LOADERS[form.loader].versionLabel!"
            >
              <USelect v-model="form.loaderVersion" :items="loaderVersionItems" class="w-full" />
            </UFormField>
          </div>

          <UFormField
            label="Memory"
            data-doc="new-server.memory"
            :description="`${(form.memoryMb / 1024).toFixed(1)} GB of heap. This machine has ${((defaults?.totalMemoryMb ?? 0) / 1024).toFixed(1)} GB.`"
          >
            <USlider
              v-model="form.memoryMb"
              :min="1024"
              :max="Math.max(1024, defaults?.maxMemoryMb ?? 4096)"
              :step="512"
            />
          </UFormField>

          <UFormField
            label="Port"
            description="Players connect to this. Firewall is opened for it."
            data-doc="new-server.port"
          >
            <UInputNumber
              v-model="form.port"
              :min="1024"
              :max="65535"
              :format-options="{ useGrouping: false }"
              class="w-40"
            />
          </UFormField>

          <UCheckbox v-model="form.acceptEula" required>
            <template #label>
              I accept the
              <ULink to="https://aka.ms/MinecraftEULA" target="_blank" class="text-primary"
                >Minecraft EULA</ULink
              >
            </template>
          </UCheckbox>

          <UButton
            type="submit"
            label="Create server"
            icon="i-lucide-hammer"
            data-doc="new-server.create"
            size="lg"
            :loading="submitting"
            :disabled="!canSubmit"
          />
        </form>
      </div>
    </template>
  </UDashboardPanel>
</template>
