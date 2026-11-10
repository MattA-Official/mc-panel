<script setup lang="ts">
useHead({ title: 'Import a server' })

interface Detected {
  kind: 'server' | 'world'
  loader: LoaderId
  loaderVersion: string | null
  mcVersion: string | null
  levelName: string
  worldFound: boolean
  hasMods: boolean
  warnings: string[]
}
interface ImportMeta {
  id: string
  label: string
  state: string
  detected: Detected | null
  error: string | null
}
interface Archive {
  file: string
  name: string
  bytes: number
  deletedAt: string
}
interface PastWorld {
  id: number
  name: string
  server: string
  serverName: string
  bytes: number
  createdAt: string
}

const toast = useToast()
const CHUNK = 32 * 1024 * 1024

const source = ref<'upload' | 'link' | 'deleted' | 'past'>('upload')
const sources = [
  { label: 'Upload a file', value: 'upload', icon: 'i-lucide-upload' },
  { label: 'From a link', value: 'link', icon: 'i-lucide-link' },
  { label: 'A deleted server', value: 'deleted', icon: 'i-lucide-archive-restore' },
  { label: 'A past world', value: 'past', icon: 'i-lucide-archive' },
]

const meta = ref<ImportMeta | null>(null)
const unpackJob = ref<number | null>(null)
const createJob = ref<number | null>(null)
const createDone = ref<JobEvent | null>(null)

// Upload
const file = ref<File | null>(null)
const progress = ref<number | null>(null)
const dragging = ref(false)
function pick(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] ?? null
}
function drop(e: DragEvent) {
  dragging.value = false
  file.value = e.dataTransfer?.files?.[0] ?? null
}
async function upload() {
  const f = file.value
  if (!f) return
  try {
    const m = await $fetch<ImportMeta>('/api/imports', {
      method: 'POST',
      body: { label: f.name, size: f.size },
    })
    progress.value = 0
    for (let offset = 0; offset < f.size; offset += CHUNK) {
      const chunk = f.slice(offset, offset + CHUNK)
      // Each chunk is retried a few times; the server only accepts it at the right offset.
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(`/api/imports/${m.id}/chunk?offset=${offset}`, {
          method: 'PUT',
          body: chunk,
        })
        if (res.ok) break
        const msg = (await res.json().catch(() => null))?.statusMessage ?? `HTTP ${res.status}`
        if (attempt >= 3 || res.status < 500) throw new Error(msg)
        await new Promise((r) => setTimeout(r, 1000 * attempt))
      }
      progress.value = Math.round(((offset + chunk.size) / f.size) * 100)
    }
    await unpack(m, {})
  } catch (err) {
    progress.value = null
    toast.add({ title: "Couldn't upload it", description: errorMessage(err), color: 'error' })
  }
}

// Link
const url = ref('')
async function fromLink() {
  try {
    const m = await $fetch<ImportMeta>('/api/imports', {
      method: 'POST',
      body: { label: url.value, size: null },
    })
    await unpack(m, { url: url.value })
  } catch (err) {
    toast.add({
      title: "Couldn't start the import",
      description: errorMessage(err),
      color: 'error',
    })
  }
}

// Deleted servers
const { data: archives } = await useFetch<Archive[]>('/api/imports/archives', { default: () => [] })
async function fromArchive(a: Archive) {
  try {
    const m = await $fetch<ImportMeta>('/api/imports', {
      method: 'POST',
      body: { label: a.file, size: null },
    })
    form.displayName = a.name
    await unpack(m, { archive: a.file })
  } catch (err) {
    toast.add({
      title: "Couldn't start the import",
      description: errorMessage(err),
      color: 'error',
    })
  }
}

// Past worlds, kept when a world was reset
const { data: pastWorlds } = await useFetch<PastWorld[]>('/api/imports/past-worlds', {
  default: () => [],
})
async function fromPastWorld(w: PastWorld) {
  try {
    const m = await $fetch<ImportMeta>('/api/imports', {
      method: 'POST',
      body: { label: w.name, size: null },
    })
    form.displayName = w.name
    await unpack(m, { pastWorld: w.id })
  } catch (err) {
    toast.add({
      title: "Couldn't start the import",
      description: errorMessage(err),
      color: 'error',
    })
  }
}
// Linked from a past world on the World tab: start straight away.
const route = useRoute()
onMounted(() => {
  const id = Number(route.query.pastWorld)
  if (!id) return
  source.value = 'past'
  const w = pastWorlds.value.find((p) => p.id === id)
  if (w) void fromPastWorld(w)
})

async function unpack(m: ImportMeta, body: object) {
  meta.value = m
  const { jobId } = await $fetch<{ jobId: number }>(`/api/imports/${m.id}/unpack` as string, {
    method: 'POST',
    body,
  })
  unpackJob.value = jobId
}
async function unpacked(e: JobEvent) {
  if (e.state !== 'succeeded' || !meta.value) return
  meta.value = await $fetch<ImportMeta>(`/api/imports/${meta.value.id}` as string)
  const d = meta.value.detected!
  form.loader = d.loader
  if (d.mcVersion) form.mcVersion = d.mcVersion
  if (d.loaderVersion) form.loaderVersion = d.loaderVersion
  if (!form.displayName) {
    form.displayName =
      d.kind === 'world'
        ? meta.value.label.replace(/\.(zip|tar\.gz|tgz|tar\.zst)$/i, '')
        : d.levelName === 'world'
          ? ''
          : d.levelName
  }
}
async function startOver() {
  if (meta.value)
    await $fetch(`/api/imports/${meta.value.id}` as string, { method: 'DELETE' }).catch(() => {})
  meta.value = null
  unpackJob.value = null
  createJob.value = null
  createDone.value = null
  progress.value = null
  file.value = null
}

// The server form
const { data: defaults } = await useFetch<{ port: number; memoryMb: number; maxMemoryMb: number }>(
  '/api/servers/defaults',
)
const form = reactive({
  displayName: '',
  name: '',
  loader: 'vanilla' as LoaderId,
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
watch(
  () => form.displayName,
  (v) => {
    form.name = v
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^[^a-z]+/, '')
      .slice(0, 31)
      .replace(/-+$/, '')
  },
)
const { data: mcVersions } = await useFetch<{ id: string; stable: boolean }[]>(
  () => `/api/loaders/${form.loader}/minecraft`,
  { query: { snapshots: true }, default: () => [] },
)
const mcItems = computed(() => mcVersions.value.map((v) => v.id))
const ready = computed(() => meta.value?.state === 'ready' && meta.value.detected)
const canCreate = computed(
  () =>
    form.displayName.trim() &&
    /^[a-z][a-z0-9-]{1,30}$/.test(form.name) &&
    form.mcVersion &&
    form.acceptEula,
)
async function create() {
  if (!meta.value) return
  try {
    const { jobId } = await $fetch<{ jobId: number }>(
      `/api/imports/${meta.value.id}/create` as string,
      { method: 'POST', body: { ...form, displayName: form.displayName.trim() } },
    )
    createJob.value = jobId
  } catch (err) {
    toast.add({
      title: "Couldn't create the server",
      description: errorMessage(err),
      color: 'error',
    })
  }
}
function size(n: number) {
  return n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`
}
</script>

<template>
  <UDashboardPanel id="import-server">
    <template #header>
      <UDashboardNavbar title="Import a server">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" variant="ghost" color="neutral" to="/servers/new" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-xl space-y-6">
        <!-- 3. Creating -->
        <div v-if="createJob" class="space-y-6">
          <h2 class="font-display text-2xl tracking-wide uppercase">
            Importing {{ form.displayName }}
          </h2>
          <JobProgress :job-id="createJob" :steps="IMPORT_STEPS" @finished="createDone = $event" />
          <div v-if="createDone" class="flex gap-3">
            <UButton
              v-if="createDone.state === 'succeeded'"
              label="Go to server"
              icon="i-lucide-arrow-right"
              trailing
              :to="`/servers/${form.name}`"
            />
            <UButton
              v-else
              label="Change details and try again"
              icon="i-lucide-rotate-ccw"
              @click="createJob = null"
            />
          </div>
        </div>

        <!-- 2. Details -->
        <form v-else-if="ready" class="space-y-6" @submit.prevent="create">
          <UAlert
            color="success"
            variant="subtle"
            icon="i-lucide-search-check"
            :title="
              meta!.detected!.kind === 'world'
                ? 'A world, ready to become a new server'
                : `A ${meta!.detected!.loader === 'vanilla' ? 'vanilla' : LOADERS[meta!.detected!.loader].label} server${meta!.detected!.hasMods ? ' with mods' : ''}`
            "
            :description="`From ${meta!.label}. The server jar is downloaded fresh; everything else is kept.`"
          />
          <UAlert
            v-for="w in meta!.detected!.warnings"
            :key="w"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :description="w"
          />
          <UFormField label="Name" required>
            <UInput v-model="form.displayName" class="w-full" maxlength="60" autofocus />
          </UFormField>
          <UFormField
            label="Short name"
            description="Used for the folder and system user."
            required
          >
            <UInput v-model="form.name" class="w-full font-mono" />
          </UFormField>
          <div class="grid gap-6 sm:grid-cols-2">
            <UFormField label="Loader">
              <USelect v-model="form.loader" :items="loaderItems" class="w-full" />
            </UFormField>
            <UFormField
              label="Minecraft version"
              :hint="meta!.detected!.mcVersion ? 'Detected' : 'Not detected, pick one'"
            >
              <USelectMenu v-model="form.mcVersion" :items="mcItems" class="w-full" />
            </UFormField>
          </div>
          <UFormField
            label="Memory"
            :description="`${(form.memoryMb / 1024).toFixed(1)} GB of heap.`"
          >
            <USlider
              v-model="form.memoryMb"
              :min="1024"
              :max="Math.max(1024, defaults?.maxMemoryMb ?? 4096)"
              :step="512"
            />
          </UFormField>
          <UFormField label="Port">
            <UInputNumber
              v-model="form.port"
              :min="1024"
              :max="65535"
              :format-options="{ useGrouping: false }"
              class="w-40"
            />
          </UFormField>
          <UCheckbox v-model="form.acceptEula">
            <template #label>
              I accept the
              <ULink to="https://aka.ms/MinecraftEULA" target="_blank" class="text-primary"
                >Minecraft EULA</ULink
              >
            </template>
          </UCheckbox>
          <div class="flex gap-3">
            <UButton
              type="submit"
              label="Import server"
              icon="i-lucide-hammer"
              size="lg"
              :disabled="!canCreate"
            />
            <UButton
              label="Start over"
              color="neutral"
              variant="ghost"
              size="lg"
              @click="startOver"
            />
          </div>
        </form>

        <!-- 1b. Unpacking -->
        <div v-else-if="unpackJob" class="space-y-4">
          <h2 class="font-semibold">Looking at {{ meta?.label }}</h2>
          <JobProgress
            :key="unpackJob"
            :job-id="unpackJob"
            :steps="UNPACK_STEPS"
            @finished="unpacked"
          />
          <UButton label="Start over" color="neutral" variant="outline" @click="startOver" />
        </div>

        <!-- 1. Source -->
        <template v-else>
          <p class="text-muted">
            Bring a server from another host or a singleplayer world. Zip, .tar.gz and .tar.zst
            files work. Vanilla, Fabric, Paper and Spigot servers can be imported.
          </p>
          <URadioGroup
            v-model="source"
            :items="sources"
            variant="card"
            orientation="horizontal"
            :ui="{ fieldset: 'grid gap-2 sm:auto-cols-fr sm:grid-flow-col', item: 'w-full' }"
          />

          <div v-if="source === 'upload'" class="space-y-4">
            <label
              class="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center"
              :class="dragging ? 'border-primary bg-primary/5' : 'border-default'"
              @dragover.prevent="dragging = true"
              @dragleave="dragging = false"
              @drop.prevent="drop"
            >
              <UIcon name="i-lucide-file-archive" class="size-8 text-muted" />
              <span v-if="file" class="font-medium">{{ file.name }} ({{ size(file.size) }})</span>
              <span v-else class="text-muted"
                >Drop a server or world archive here, or click to choose</span
              >
              <input
                type="file"
                class="sr-only"
                accept=".zip,.gz,.tgz,.zst"
                aria-label="Archive to import"
                @change="pick"
              />
            </label>
            <UProgress v-if="progress !== null" :model-value="progress" />
            <UButton
              label="Upload and look inside"
              icon="i-lucide-upload"
              :disabled="!file || progress !== null"
              @click="upload"
            />
          </div>

          <form v-else-if="source === 'link'" class="space-y-4" @submit.prevent="fromLink">
            <UFormField label="Link to the archive" description="It must start with https://">
              <UInput v-model="url" type="url" class="w-full" placeholder="https://…/server.zip" />
            </UFormField>
            <UButton
              type="submit"
              label="Fetch and look inside"
              icon="i-lucide-download"
              :disabled="!url.startsWith('https://')"
            />
          </form>

          <div v-else-if="source === 'past'" class="space-y-2">
            <p v-if="!pastWorlds.length" class="text-sm text-muted">
              No past worlds yet. They're kept when you reset a server's world.
            </p>
            <button
              v-for="w in pastWorlds"
              :key="w.id"
              type="button"
              class="flex w-full items-center justify-between rounded-lg border border-default px-4 py-3 text-left hover:bg-elevated"
              @click="fromPastWorld(w)"
            >
              <span>
                <span class="font-medium">{{ w.name }}</span>
                <span class="block text-xs text-muted">
                  From {{ w.serverName }} · kept {{ formatDateTime(w.createdAt) }} ·
                  {{ size(w.bytes) }}
                </span>
              </span>
              <UIcon name="i-lucide-chevron-right" class="size-4 text-muted" />
            </button>
          </div>

          <div v-else class="space-y-2">
            <p v-if="!archives.length" class="text-sm text-muted">
              No deleted servers to bring back.
            </p>
            <button
              v-for="a in archives"
              :key="a.file"
              type="button"
              class="flex w-full items-center justify-between rounded-lg border border-default px-4 py-3 text-left hover:bg-elevated"
              @click="fromArchive(a)"
            >
              <span>
                <span class="font-medium">{{ a.name }}</span>
                <span class="block text-xs text-muted">
                  Deleted {{ formatDateTime(a.deletedAt) }} · {{ size(a.bytes) }}
                </span>
              </span>
              <UIcon name="i-lucide-chevron-right" class="size-4 text-muted" />
            </button>
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
