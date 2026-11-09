<script setup lang="ts">
/** Pre-generates the world with Chunky, so players don't wait for new chunks. */
interface Task {
  world: string
  percent: number
  chunks: number
  eta: string | null
  rate: number | null
}
interface Status {
  blocked: 'vanilla' | 'no-chunky' | 'stopped' | null
  tasks: Task[]
}

const { server } = useServerContext()
const toast = useToast()
const name = computed(() => server.value?.name ?? '')
const change = ref<{ propose: (spec: unknown, o: { title: string }) => Promise<void> }>()

const { data, refresh } = await useFetch<Status>(() => `/api/servers/${name.value}/world/pregen`, {
  default: () => ({ blocked: null, tasks: [] }),
})
// Poll while the tab is open; quicker while something is running.
let timer: ReturnType<typeof setTimeout> | undefined
function schedule() {
  timer = setTimeout(
    async () => {
      await refresh().catch(() => {})
      schedule()
    },
    data.value?.tasks.some((t) => t.percent < 100) ? 3000 : 10000,
  )
}
onMounted(schedule)
onBeforeUnmount(() => clearTimeout(timer))

const DIMENSIONS = [
  { label: 'Overworld', value: 'overworld' },
  { label: 'Nether', value: 'the_nether' },
  { label: 'End', value: 'the_end' },
]
const dimensionLabel = (world: string) =>
  DIMENSIONS.find((d) => `minecraft:${d.value}` === world)?.label ?? world

const form = reactive({
  dimension: 'overworld',
  radius: 2000,
  atSpawn: true,
  x: 0,
  z: 0,
  shape: 'square',
})
// Chunks are 16 blocks; a square of radius r is (2r/16)² chunks.
const chunks = computed(() => {
  const side = Math.ceil((form.radius * 2) / 16)
  return Math.round(form.shape === 'circle' ? (Math.PI * side * side) / 4 : side * side)
})

const busy = ref<string | null>(null)
async function act(action: string, body: Record<string, unknown> = {}) {
  busy.value = action
  try {
    const r = await $fetch<{ reply: string }>(`/api/servers/${name.value}/world/pregen` as string, {
      method: 'POST',
      body: { action, ...body },
    })
    toast.add({ title: 'Chunky', description: r.reply || 'Done.', color: 'success' })
    await refresh()
  } catch (err) {
    toast.add({ title: "Chunky couldn't do that", description: errorMessage(err), color: 'error' })
  } finally {
    busy.value = null
  }
}
const start = () =>
  act('start', {
    dimension: form.dimension,
    radius: form.radius,
    center: form.atSpawn ? null : { x: form.x, z: form.z },
    shape: form.shape,
  })

async function addChunky() {
  const { spec } = await $fetch<{ spec: { content: unknown[] } }>(
    `/api/servers/${name.value}/spec` as string,
  )
  await change.value?.propose(
    { ...spec, content: [...spec.content, { modrinth: 'chunky' }] },
    { title: 'Add Chunky' },
  )
}
</script>

<template>
  <section v-if="server" class="rounded-lg border border-default p-5">
    <h2 class="font-display text-lg tracking-wide uppercase">Pre-generate</h2>
    <p class="mt-1 text-sm text-muted">
      Generates the world ahead of time with Chunky, so exploring doesn't lag. It runs in the
      background and carries on after a restart.
    </p>

    <UAlert
      v-if="data.blocked === 'vanilla'"
      class="mt-4"
      color="neutral"
      variant="subtle"
      icon="i-lucide-info"
      title="Needs Fabric"
      description="Chunky is a Fabric mod. Change the loader to Fabric in Settings to use it."
      :actions="[
        {
          label: 'Settings',
          to: `/servers/${server.name}/settings`,
          color: 'neutral',
          variant: 'outline',
        },
      ]"
    />
    <UAlert
      v-else-if="data.blocked === 'no-chunky'"
      class="mt-4"
      color="neutral"
      variant="subtle"
      icon="i-lucide-package-plus"
      title="Chunky isn't installed"
      description="Add it (and Fabric API, which it needs) to pre-generate the world."
      :actions="[{ label: 'Add Chunky', icon: 'i-lucide-plus', onClick: addChunky }]"
    />
    <UAlert
      v-else-if="data.blocked === 'stopped'"
      class="mt-4"
      color="neutral"
      variant="subtle"
      icon="i-lucide-power"
      title="Start the server to pre-generate"
    />

    <template v-else>
      <div v-for="t in data.tasks" :key="t.world" class="mt-4 space-y-2" data-e2e="pregen-task">
        <div class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span class="font-medium">{{ dimensionLabel(t.world) }}</span>
          <span class="text-muted tabular-nums">
            {{ t.percent.toFixed(1) }}% · {{ t.chunks.toLocaleString('en-GB') }} chunks
            <template v-if="t.eta"> · {{ t.eta }} left</template>
            <template v-if="t.rate"> · {{ t.rate }}/s</template>
          </span>
        </div>
        <UProgress :model-value="t.percent" :max="100" />
      </div>
      <div v-if="data.tasks.length" class="mt-3 flex flex-wrap justify-end gap-2">
        <UButton
          label="Pause"
          icon="i-lucide-pause"
          color="neutral"
          variant="outline"
          :loading="busy === 'pause'"
          @click="act('pause')"
        />
        <UButton
          label="Cancel"
          icon="i-lucide-x"
          color="error"
          variant="soft"
          :loading="busy === 'cancel'"
          @click="act('cancel')"
        />
      </div>

      <div v-else class="mt-4 space-y-4">
        <div class="grid gap-4 sm:grid-cols-3">
          <UFormField label="Dimension">
            <USelect v-model="form.dimension" :items="DIMENSIONS" class="w-full" />
          </UFormField>
          <UFormField label="Radius (blocks)">
            <UInputNumber
              v-model="form.radius"
              :min="16"
              :max="100000"
              :step="500"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Shape">
            <USelect
              v-model="form.shape"
              :items="[
                { label: 'Square', value: 'square' },
                { label: 'Circle', value: 'circle' },
              ]"
              class="w-full"
            />
          </UFormField>
        </div>
        <div class="flex flex-wrap items-end gap-4">
          <USwitch v-model="form.atSpawn" label="Centred on spawn" />
          <template v-if="!form.atSpawn">
            <UFormField label="X"><UInputNumber v-model="form.x" class="w-32" /></UFormField>
            <UFormField label="Z"><UInputNumber v-model="form.z" class="w-32" /></UFormField>
          </template>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-xs text-muted">
            About {{ chunks.toLocaleString('en-GB') }} chunks. Players can stay on while it runs.
          </p>
          <div class="flex gap-2">
            <UButton
              label="Continue paused"
              color="neutral"
              variant="ghost"
              :loading="busy === 'continue'"
              @click="act('continue')"
            />
            <UButton
              label="Start"
              icon="i-lucide-play"
              :loading="busy === 'start'"
              data-e2e="pregen-start"
              @click="start"
            />
          </div>
        </div>
      </div>
    </template>
    <SpecChange ref="change" :server="server.name" @applied="refresh()" />
  </section>
</template>
