<script setup lang="ts">
import {
  BOARDS,
  PERIOD_LABELS,
  PERIODS,
  formatStat,
  type Period,
  type StatsOverview,
} from '#shared/leaderboards'

const { server } = useServerContext()
useHead({ title: () => `Stats · ${server.value?.displayName ?? ''}` })
const can = useCan()
const toast = useToast()

const period = ref<Period>('all')
const url = computed(() => `/api/servers/${server.value?.name}/stats/leaderboards`)
const { data, refresh, status } = await useFetch<StatsOverview>(url, {
  query: { period },
  immediate: !!server.value,
})

const units = Object.fromEntries(BOARDS.map((b) => [b.key, b.unit]))

const search = ref('')
const cards = computed(() => {
  const q = search.value.trim().toLowerCase()
  const all = data.value?.players ?? []
  return q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all
})
const SHOWN = 24
const showAll = ref(false)
const shown = computed(() => (showAll.value ? cards.value : cards.value.slice(0, SHOWN)))

const hasAny = computed(() => (data.value?.boards ?? []).some((b) => b.entries.length))

const taking = ref(false)
async function takeNow() {
  if (!server.value) return
  taking.value = true
  try {
    const { stored } = await $fetch<{ stored: number }>(
      `/api/servers/${server.value.name}/stats/snapshot` as string,
      { method: 'POST' },
    )
    await refresh()
    toast.add({
      title: stored
        ? `Read stats for ${stored} player${stored === 1 ? '' : 's'}`
        : 'Nothing new to read',
      color: 'success',
    })
  } catch (err) {
    toast.add({ title: "Couldn't read the stats", description: errorMessage(err), color: 'error' })
  } finally {
    taking.value = false
  }
}

const sinceLabel = computed(() =>
  data.value?.since ? `since ${formatDate(`${data.value.since}T12:00:00`)}` : '',
)
</script>

<template>
  <div v-if="server" class="mx-auto w-full max-w-5xl space-y-6" data-e2e="stats-tab">
    <UAlert
      v-if="data && !data.enabled"
      color="neutral"
      variant="subtle"
      icon="i-lucide-pause"
      title="Player stats are off"
      description="Nothing new is being kept for this server. What was kept before is still shown."
      :actions="
        can('server.configure', server.name)
          ? [
              {
                label: 'Settings',
                color: 'neutral',
                variant: 'outline',
                to: `/servers/${server.name}/settings`,
              },
            ]
          : []
      "
    />

    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted">
        <template v-if="data?.updatedAt">
          From the stats Minecraft keeps, read once a day at 03:30. Last read
          {{ formatDateTime(data.updatedAt) }}.
        </template>
        <template v-else>From the stats Minecraft keeps, read once a day at 03:30.</template>
      </p>
      <div class="flex items-center gap-2">
        <UButton
          v-if="can('server.configure', server.name) && data?.enabled"
          label="Read now"
          icon="i-lucide-refresh-cw"
          size="xs"
          color="neutral"
          variant="ghost"
          :loading="taking"
          data-e2e="stats-read-now"
          @click="takeNow"
        />
        <div class="flex gap-1" role="group" aria-label="Period">
          <UButton
            v-for="p in PERIODS"
            :key="p"
            :label="PERIOD_LABELS[p]"
            size="xs"
            :color="period === p ? 'primary' : 'neutral'"
            :variant="period === p ? 'soft' : 'ghost'"
            :aria-pressed="period === p"
            :data-e2e="`stats-period-${p}`"
            @click="period = p"
          />
        </div>
      </div>
    </div>

    <UEmpty
      v-if="data && !hasAny && !data.players.length"
      icon="i-lucide-trophy"
      :title="data.updatedAt ? 'Nothing for this period yet' : 'No stats yet'"
      :description="
        data.updatedAt
          ? 'Nobody has played since it began, or the next daily read hasn\'t happened yet.'
          : 'The first figures arrive after the next daily read at 03:30, once someone has played.'
      "
    />

    <template v-else-if="data">
      <div
        class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        :class="{ 'opacity-60': status === 'pending' }"
      >
        <LeaderboardList v-for="b in data.boards" :key="b.key" :board="b" />
      </div>

      <section class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-display text-lg tracking-wide uppercase">
            Players
            <span class="ml-1 font-sans text-sm tracking-normal text-muted normal-case">{{
              sinceLabel
            }}</span>
          </h2>
          <UInput
            v-model="search"
            icon="i-lucide-search"
            placeholder="Find a player"
            size="sm"
            class="w-full sm:w-56"
            aria-label="Find a player"
          />
        </div>
        <p v-if="!cards.length" class="text-sm text-muted">Nobody by that name.</p>
        <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-e2e="stats-players">
          <li
            v-for="p in shown"
            :key="p.uuid"
            class="rounded-lg border border-default p-4"
            :data-e2e="`stats-player-${p.name}`"
          >
            <div class="flex items-center gap-3">
              <PlayerHead :uuid="p.uuid" :size="32" />
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-2 truncate font-medium">
                  {{ p.name }}
                  <UBadge
                    v-if="p.online"
                    label="Online"
                    color="success"
                    variant="subtle"
                    size="sm"
                  />
                </p>
                <p class="truncate text-xs text-muted">
                  <template v-if="p.lastSeen">
                    Last seen {{ formatDate(p.lastSeen) }} · {{ p.sessions }} visit{{
                      p.sessions === 1 ? '' : 's'
                    }}
                  </template>
                  <template v-else>Played before Flytower kept visits</template>
                </p>
              </div>
            </div>
            <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div v-for="b in BOARDS" :key="b.key" class="min-w-0">
                <dt class="flex items-center gap-1 truncate text-muted">
                  <BoardIcon :board="b.key" class="size-3.5 shrink-0" />
                  {{ b.label }}
                </dt>
                <dd class="truncate font-mono tabular-nums">
                  {{ formatStat(units[b.key]!, p.stats[b.key]) }}
                </dd>
              </div>
            </dl>
          </li>
        </ul>
        <div v-if="cards.length > SHOWN" class="flex justify-center">
          <UButton
            :label="showAll ? 'Show fewer' : `Show all ${cards.length}`"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="showAll = !showAll"
          />
        </div>
      </section>
    </template>
  </div>
</template>
