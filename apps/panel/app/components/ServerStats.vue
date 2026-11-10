<script setup lang="ts">
/** Whether the server keeps player stats, and which players are left out of them. */
import type { LeftOutPlayer, StatsSettings } from '#shared/stats-settings'

const { server, refresh } = useServerContext()
const toast = useToast()

interface Seen {
  uuid: string
  name: string
}

// Players to choose from: everyone who has played here, and everyone on the whitelist.
const { data: seen } = useFetch(() => `/api/servers/${server.value?.name}/stats/players`, {
  immediate: !!server.value,
  default: () => ({ players: [] as Seen[] }),
})
const { data: lists } = useFetch(() => `/api/servers/${server.value?.name}/players`, {
  immediate: !!server.value,
  default: () => ({ whitelist: [] as Seen[] }),
})

const leftOut = computed(() => server.value?.stats.leaveOut ?? [])
const choices = computed(() => {
  const out = new Map<string, Seen>()
  for (const p of [...(seen.value?.players ?? []), ...(lists.value?.whitelist ?? [])]) {
    if (!out.has(p.uuid)) out.set(p.uuid, { uuid: p.uuid, name: p.name })
  }
  for (const p of leftOut.value) out.delete(p.uuid)
  return [...out.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ label: p.name, value: p.uuid }))
})
const picked = ref<string | undefined>()

const saving = ref(false)
async function save(next: StatsSettings, done: string) {
  if (!server.value) return
  saving.value = true
  try {
    await $fetch(`/api/servers/${server.value.name}/stats/settings` as string, {
      method: 'PATCH',
      body: next,
    })
    await refresh()
    toast.add({ title: done, color: 'success' })
  } catch (err) {
    toast.add({ title: "Couldn't save that", description: errorMessage(err), color: 'error' })
  } finally {
    saving.value = false
  }
}

function setEnabled(enabled: boolean) {
  if (!server.value) return
  void save(
    { ...server.value.stats, enabled },
    enabled ? 'Player stats turned on' : 'Player stats turned off',
  )
}

function leaveOut() {
  const p = choices.value.find((c) => c.value === picked.value)
  if (!server.value || !p) return
  const player: LeftOutPlayer = { uuid: p.value, name: p.label }
  picked.value = undefined
  void save(
    { ...server.value.stats, leaveOut: [...leftOut.value, player] },
    `${player.name} is left out of stats`,
  )
}

function putBack(uuid: string) {
  if (!server.value) return
  const p = leftOut.value.find((x) => x.uuid === uuid)
  void save(
    { ...server.value.stats, leaveOut: leftOut.value.filter((x) => x.uuid !== uuid) },
    `${p?.name ?? 'They'} will be counted again`,
  )
}
</script>

<template>
  <section v-if="server" class="rounded-lg border border-default p-5" data-e2e="stats-settings">
    <h2 class="font-display text-lg tracking-wide uppercase">Player stats</h2>
    <p class="mt-1 text-sm text-muted">
      Flytower keeps when each player joins and leaves, and once a day a short list of their stats
      (deaths, kills, distance travelled, blocks mined and so on) from the files Minecraft already
      writes. Only people who can see this server in the panel can see them.
    </p>
    <USwitch
      class="mt-4"
      :model-value="server.stats.enabled"
      :loading="saving"
      :disabled="saving"
      label="Keep player stats"
      description="Off, nothing new is kept. What's already kept stays."
      data-e2e="stats-enabled"
      @update:model-value="(v: boolean) => setEnabled(v)"
    />

    <div class="mt-5">
      <h3 class="text-sm font-medium">Left out</h3>
      <p class="mt-1 text-sm text-muted">
        Players who would rather not be counted. Leaving someone out deletes what was kept about
        them on this server.
      </p>
      <ul
        v-if="leftOut.length"
        class="mt-3 divide-y divide-default rounded-md border border-default"
      >
        <li
          v-for="p in leftOut"
          :key="p.uuid"
          class="flex items-center justify-between gap-3 px-3 py-2 text-sm"
        >
          <span class="truncate">{{ p.name }}</span>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            label="Count again"
            :disabled="saving"
            @click="putBack(p.uuid)"
          />
        </li>
      </ul>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <USelectMenu
          v-model="picked"
          :items="choices"
          value-key="value"
          placeholder="Choose a player"
          class="w-full sm:w-64"
          :disabled="saving || !choices.length"
          data-e2e="stats-leave-out-pick"
        />
        <UButton
          label="Leave out"
          color="neutral"
          variant="outline"
          :disabled="saving || !picked"
          data-e2e="stats-leave-out"
          @click="leaveOut"
        />
      </div>
    </div>
  </section>
</template>
