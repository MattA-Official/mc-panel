<script setup lang="ts">
/** The web map: adding squaremap, who may open the map, and whether it shows players. */
import type { MapSettings } from '#shared/map-settings'

interface Status {
  blocked: 'loader' | 'not-installed' | null
  ready: boolean
}

const { server, refresh: refreshServer } = useServerContext()
const toast = useToast()
const name = computed(() => server.value?.name ?? '')
const change = ref<{ propose: (spec: unknown, o: { title: string }) => Promise<void> }>()

const { data, refresh } = await useFetch<Status>(() => `/api/servers/${name.value}/map`, {
  default: () => ({ blocked: null, ready: false }),
})

async function addSquaremap() {
  const { spec } = await $fetch<{ spec: { content: unknown[] } }>(
    `/api/servers/${name.value}/spec` as string,
  )
  await change.value?.propose(
    { ...spec, content: [...spec.content, { modrinth: 'squaremap' }] },
    { title: 'Add squaremap' },
  )
}

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

const pageOn = computed(() => !!server.value?.publicPage.enabled)
</script>

<template>
  <section v-if="server" class="rounded-lg border border-default p-5" data-e2e="world-map">
    <h2 class="text-base font-semibold">Web map</h2>
    <p class="mt-1 text-sm text-muted">
      A map of the world in the browser, drawn by squaremap inside the server as players explore. It
      shows where everyone is as they play, and needs no extra memory or ports.
    </p>

    <UAlert
      v-if="data.blocked === 'loader'"
      class="mt-4"
      color="neutral"
      variant="subtle"
      icon="i-lucide-info"
      title="Needs Fabric or Paper"
      description="squaremap runs on Fabric or Paper. Change the loader in Settings to use it."
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
      v-else-if="data.blocked === 'not-installed'"
      class="mt-4"
      color="neutral"
      variant="subtle"
      icon="i-lucide-map"
      title="squaremap isn't installed"
      :description="
        server.loader === 'paper'
          ? 'Add the squaremap plugin to make a web map. The server restarts to load it.'
          : 'Add squaremap (and Fabric API, which it needs) to make a web map. The server restarts to load it.'
      "
      :actions="[{ label: 'Add squaremap', icon: 'i-lucide-plus', onClick: addSquaremap }]"
      data-e2e="map-add"
    />

    <template v-else>
      <p v-if="!data.ready" class="mt-4 text-sm text-muted" data-e2e="map-waiting">
        squaremap makes the map the next time the server starts.
      </p>
      <div class="mt-4 space-y-4">
        <USwitch
          :model-value="server.map.players"
          :loading="saving"
          :disabled="saving"
          label="Show players"
          description="Where each online player is, updated every second. Off, positions are never written to disk."
          data-e2e="map-players"
          @update:model-value="
            (v: boolean) =>
              save({ players: v }, v ? 'Players shown on the map' : 'Players hidden from the map')
          "
        />
        <USwitch
          :model-value="server.map.public"
          :loading="saving"
          :disabled="saving"
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
      </div>
    </template>
    <SpecChange ref="change" :server="server.name" @applied="refresh()" />
  </section>
</template>
