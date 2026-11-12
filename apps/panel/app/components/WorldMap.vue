<script setup lang="ts">
/**
 * The web map: on or off, who may open it, whether it shows players, and how drawing is
 * going. Flytower draws it from the world files, so nothing is added to the server.
 */
import type { MapSettings } from '#shared/map-settings'

interface Pass {
  at: string
  ms: number
  full: boolean
  drawn: number
  unchanged: number
  removed: number
  chunks: number
  errors: number
  firstError: string | null
  colours: 'game' | 'built-in'
}
interface Status {
  enabled: boolean
  state: 'off' | 'waiting' | 'queued' | 'drawing' | 'idle'
  lastPass: Pass | null
  error: string | null
  progress: { done: number; total: number } | null
}

const { server, refresh: refreshServer } = useServerContext()
const toast = useToast()
const can = useCan()
const name = computed(() => server.value?.name ?? '')
const canConfigure = computed(() => can('community.manage', name.value))
const canDraw = computed(() => can('world.manage', name.value))

const status = ref<Status | null>(null)
// The map service sends its status as it changes: nothing here is polled.
useTopic<Status>(
  () => (name.value ? `map:${name.value}` : null),
  (s) => (status.value = s),
)

const saving = ref(false)
async function save(patch: Partial<MapSettings>, done: string) {
  if (!server.value) return
  saving.value = true
  try {
    await $fetch(`/api/servers/${name.value}/map/settings` as string, {
      method: 'PATCH',
      body: { ...server.value.map, ...patch },
    })
    await refreshServer()
    toast.add({ title: done, color: 'success' })
  } catch (err) {
    toast.add({ title: "Couldn't save that", description: errorMessage(err), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function draw(full: boolean) {
  try {
    await $fetch(`/api/servers/${name.value}/map/draw` as string, {
      method: 'POST',
      body: { full },
    })
  } catch (err) {
    toast.add({ title: "Couldn't start drawing", description: errorMessage(err), color: 'error' })
  }
}

const busy = computed(() => status.value?.state === 'drawing' || status.value?.state === 'queued')
const pageOn = computed(() => !!server.value?.publicPage.enabled)
const path = computed(() => `/s/${encodeURIComponent(name.value)}/map/`)
// The address to share: on the server's own hostname when it has one and the map is public.
const shareUrl = computed(() => {
  if (!server.value?.map.public || !pageOn.value) return null
  return server.value.hostname
    ? `https://${server.value.hostname}/map/`
    : `${useRequestURL().origin}${path.value}`
})
const copied = ref(false)
async function copy(text: string) {
  await navigator.clipboard.writeText(text).catch(() => {})
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`

const stateLine = computed(() => {
  switch (status.value?.state) {
    case 'drawing':
      return 'Drawing the map now…'
    case 'queued':
      return 'Waiting for saving to finish, then drawing what changed.'
    case 'waiting':
      return "The world hasn't been made yet. The map is drawn once the server has started."
    default:
      return null
  }
})

// How far the pass being drawn has got, counted in region files (512×512 blocks each).
const progress = computed(() => {
  const p = status.value?.state === 'drawing' ? status.value.progress : null
  if (!p || p.total === 0) return null
  return { ...p, percent: (p.done / p.total) * 100 }
})

const lastLine = computed(() => {
  const p = status.value?.lastPass
  if (!p) return null
  const when = new Date(p.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const what =
    p.drawn === 0
      ? 'nothing had changed'
      : `${plural(p.drawn, 'region')} redrawn (${plural(p.chunks, 'chunk')})`
  return `Last drawn ${when}: ${what}, in ${(p.ms / 1000).toFixed(1)} s.`
})
</script>

<template>
  <section v-if="server" class="rounded-lg border border-default p-5" data-e2e="world-map">
    <h2 class="text-base font-semibold">Web map</h2>
    <p class="mt-1 text-sm text-muted">
      A map of the world to open in the browser, drawn by Flytower from the world files as players
      explore. Nothing is added to the server, and only the parts of the world that changed are
      drawn again.
    </p>

    <div class="mt-4 space-y-4">
      <USwitch
        :model-value="server.map.enabled"
        :loading="saving"
        :disabled="saving || !canConfigure"
        label="Draw a web map"
        description="Off, nothing is drawn and the map's files are removed."
        data-e2e="map-enabled"
        @update:model-value="
          (v: boolean) => save({ enabled: v }, v ? 'The web map is on' : 'The web map is off')
        "
      />

      <template v-if="server.map.enabled">
        <div class="space-y-1 text-sm" data-e2e="map-status">
          <p v-if="stateLine" class="flex items-center gap-2">
            <UIcon v-if="busy" name="i-lucide-loader-circle" class="size-4 animate-spin" />
            {{ stateLine }}
            <span v-if="progress" class="ml-auto text-muted tabular-nums">
              {{ progress.done.toLocaleString() }} of {{ plural(progress.total, 'region') }}
            </span>
          </p>
          <UProgress
            v-if="progress"
            :model-value="progress.percent"
            :max="100"
            class="py-1"
            data-e2e="map-progress"
          />
          <p v-if="lastLine" class="text-muted">{{ lastLine }}</p>
          <p v-if="status?.lastPass?.errors" class="text-muted">
            {{ plural(status.lastPass.errors, 'chunk') }} couldn't be read and
            {{ status.lastPass.errors === 1 ? 'was' : 'were' }} left out<template
              v-if="status.lastPass.firstError"
              >: {{ status.lastPass.firstError }}</template
            >.
          </p>
          <p v-if="status?.lastPass?.colours === 'built-in'" class="text-muted">
            Drawn with simpler colours, because the game's couldn't be fetched. The next drawing
            tries again.
          </p>
        </div>
        <UAlert
          v-if="status?.error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="The last drawing failed"
          :description="status.error"
        />

        <div class="flex flex-wrap items-center gap-2">
          <UButton
            v-if="status?.lastPass"
            :to="path"
            target="_blank"
            external
            label="Open map"
            icon="i-lucide-map"
            data-e2e="map-open"
          />
          <UButton
            v-if="canDraw"
            label="Draw now"
            icon="i-lucide-brush"
            color="neutral"
            variant="outline"
            :disabled="busy"
            data-e2e="map-draw"
            @click="draw(false)"
          />
          <UButton
            v-if="canDraw"
            label="Redraw everything"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            :disabled="busy"
            data-e2e="map-redraw"
            @click="draw(true)"
          />
        </div>
        <div v-if="shareUrl" class="flex items-center gap-2">
          <code class="truncate rounded bg-elevated px-2 py-1 text-xs">{{ shareUrl }}</code>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            :aria-label="copied ? 'Copied' : 'Copy the map\'s address'"
            @click="copy(shareUrl)"
          />
        </div>

        <USwitch
          :model-value="server.map.players"
          :loading="saving"
          :disabled="saving || !canConfigure"
          label="Show players"
          :description="
            server.map.public && pageOn && server.publicPage.show.players !== 'names'
              ? 'Only for people signed in. The public page hides player names, so the public map does too.'
              : 'Where each online player is, while someone has the map open. Without signing in, only when the public page shows player names.'
          "
          data-e2e="map-players"
          @update:model-value="
            (v: boolean) =>
              save({ players: v }, v ? 'Players shown on the map' : 'Players hidden from the map')
          "
        />
        <USwitch
          :model-value="server.map.public"
          :loading="saving"
          :disabled="saving || !canConfigure"
          label="Anyone can open it"
          :description="
            pageOn
              ? 'Linked from the public page, with no sign-in. Off, only people who can see this server in the panel can.'
              : 'Turn on the public page in Settings first. Until then, only people who can see this server in the panel can open it.'
          "
          data-e2e="map-public"
          @update:model-value="
            (v: boolean) => save({ public: v }, v ? 'The map is public' : 'The map is private')
          "
        />
      </template>
    </div>
  </section>
</template>
