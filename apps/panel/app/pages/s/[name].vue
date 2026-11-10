<script setup lang="ts">
/**
 * A server's public status page: anyone can open it without signing in. It shows only what
 * the server's settings allow, from /api/public/servers/<name>.
 */
import type { PublicStatus } from '#shared/public-page'
import { layoutMotd, motdPlainText } from '~~/shared/utils/motd'

definePageMeta({ layout: 'public' })

const route = useRoute()
const name = computed(() => String(route.params.name))
const { data, error, refresh } = await useFetch<PublicStatus>(
  () => `/api/public/servers/${encodeURIComponent(name.value)}`,
)
useHead(() => ({ title: data.value?.displayName ?? 'Not found' }))

// Keep it current while someone's looking, and catch up as soon as they come back.
function onVisible() {
  if (document.visibilityState === 'visible') void refresh()
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(onVisible, 30_000)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisible)
})

const STATES = {
  online: { label: 'Online', color: 'success', icon: 'i-lucide-circle-check' },
  starting: { label: 'Starting', color: 'warning', icon: 'i-lucide-loader-circle' },
  offline: { label: 'Offline', color: 'neutral', icon: 'i-lucide-circle-stop' },
} as const
const state = computed(() => (data.value ? STATES[data.value.state] : null))

const copied = ref(false)
async function copy() {
  if (!data.value) return
  await navigator.clipboard.writeText(data.value.address).catch(() => {})
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

// The MOTD as the multiplayer list shows it: two lines, in the game's colours.
const motd = computed(() =>
  data.value?.motd && motdPlainText(data.value.motd).trim()
    ? layoutMotd(data.value.motd).visible
    : [],
)

const skin = (uuid: string) =>
  `/api/public/servers/${encodeURIComponent(name.value)}/skins/${encodeURIComponent(uuid)}.png`

const playersLine = computed(() => {
  const p = data.value?.players
  if (!p || data.value?.state !== 'online') return null
  const of = p.max ? ` of ${p.max}` : ''
  if (p.count === 0) return `Nobody's on right now${p.max ? ` (${p.max} slots)` : ''}.`
  return `${p.count}${of} ${p.count === 1 ? 'player' : 'players'} online`
})
</script>

<template>
  <div v-if="error" class="py-16 text-center" data-e2e="status-missing">
    <h1 class="font-display text-3xl tracking-wide uppercase">Nothing here</h1>
    <p class="mt-2 text-muted">
      There's no public page at this address. It may have been turned off.
    </p>
  </div>
  <article v-else-if="data && state" class="space-y-6" data-e2e="status-page">
    <header class="space-y-3">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="min-w-0 font-display text-4xl tracking-wide break-words uppercase">
          {{ data.displayName }}
        </h1>
        <UBadge
          :label="state.label"
          :color="state.color"
          :icon="state.icon"
          variant="subtle"
          size="lg"
          data-e2e="status-state"
        />
      </div>
      <div
        v-if="motd.length"
        class="motd rounded-md bg-neutral-900 px-3 py-2 font-mono text-sm leading-snug"
        data-e2e="status-motd"
      >
        <div v-for="(line, i) in motd" :key="i"><MotdText :line="line" /></div>
      </div>
      <p v-if="data.description" class="whitespace-pre-line text-default">
        {{ data.description }}
      </p>
    </header>

    <section class="rounded-lg border border-default p-5">
      <h2 class="text-sm font-semibold text-muted">Join with</h2>
      <div class="mt-2 flex min-w-0 items-center gap-2">
        <span class="truncate font-mono text-lg" data-e2e="status-address">{{ data.address }}</span>
        <UButton
          :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
          :label="copied ? 'Copied' : 'Copy'"
          size="sm"
          color="neutral"
          variant="subtle"
          @click="copy"
        />
      </div>
      <p class="mt-2 text-sm text-muted">
        In Minecraft, choose <strong>Multiplayer</strong>, then <strong>Add Server</strong>, and
        paste this as the server address.
      </p>
      <p v-if="data.version" class="mt-3 text-sm text-muted" data-e2e="status-version">
        {{ data.version.loader }}, Minecraft {{ data.version.minecraft }}
      </p>
    </section>

    <section
      v-if="data.players && playersLine"
      class="rounded-lg border border-default p-5"
      data-e2e="status-players"
    >
      <h2 class="font-semibold">{{ playersLine }}</h2>
      <ul v-if="data.players.list?.length" class="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        <li v-for="p in data.players.list" :key="p.name" class="flex items-center gap-2">
          <PlayerHead :uuid="p.uuid" :src="skin(p.uuid)" :size="24" />
          <span>{{ p.name }}</span>
        </li>
      </ul>
    </section>
  </article>
</template>
