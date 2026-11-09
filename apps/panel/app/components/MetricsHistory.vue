<script setup lang="ts">
/**
 * The last hour, day or week of a server's (or, without `server`, the machine's) CPU,
 * memory, players, tick time and disk. Sampled once a minute and kept for a week.
 */
const props = defineProps<{ server?: string }>()

interface Point {
  at: number
  cpu: number | null
  memMb: number | null
  players: number | null
  mspt: number | null
  diskMb: number | null
}
interface History {
  step: number
  points: Point[]
  limits: { memMb: number | null; diskMb?: number | null }
}

const ranges = [
  { value: 'hour', label: 'Hour' },
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
] as const
const range = ref<(typeof ranges)[number]['value']>('hour')
const url = computed(() =>
  props.server ? `/api/servers/${props.server}/metrics` : '/api/system/metrics',
)
const { data, refresh } = await useFetch<History>(url, { query: { range } })
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => (timer = setInterval(() => void refresh(), 60_000)))
onBeforeUnmount(() => clearInterval(timer))

const pick = (k: keyof Omit<Point, 'at'>) =>
  (data.value?.points ?? []).map((p) => ({ at: p.at, value: p[k] }))
const gb = (mb: number) => `${(mb / 1024).toFixed(mb < 10 * 1024 ? 1 : 0)} GB`
const pct = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%`
const ms = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`
const count = (v: number) => String(Math.round(v))
const empty = computed(() => !(data.value?.points ?? []).some((p) => p.memMb !== null))
</script>

<template>
  <section class="space-y-3" data-e2e="metrics">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm text-muted">
        {{
          server
            ? 'Sampled every minute while the server runs, kept for a week.'
            : 'The whole machine, sampled every minute and kept for a week.'
        }}
      </p>
      <div class="flex gap-1" role="group" aria-label="Time range">
        <UButton
          v-for="r in ranges"
          :key="r.value"
          :label="r.label"
          size="xs"
          :color="range === r.value ? 'primary' : 'neutral'"
          :variant="range === r.value ? 'soft' : 'ghost'"
          :aria-pressed="range === r.value"
          @click="range = r.value"
        />
      </div>
    </div>
    <p v-if="empty && server" class="text-sm text-muted">
      Nothing yet. Charts fill in once the server has been running for a minute or two.
    </p>
    <div class="grid gap-4 sm:grid-cols-2">
      <MetricChart label="CPU" :points="pick('cpu')" :format="pct" :max="100" />
      <MetricChart
        label="Memory"
        :points="pick('memMb')"
        :format="gb"
        :max="data?.limits.memMb ?? null"
      />
      <template v-if="server">
        <MetricChart label="Players online" :points="pick('players')" :format="count" :max="4" />
        <MetricChart
          label="Time per tick"
          :points="pick('mspt')"
          :format="ms"
          :target="{ value: 50, label: '50 ms: lag above this' }"
        />
      </template>
      <MetricChart
        v-else
        label="Disk used"
        :points="pick('diskMb')"
        :format="gb"
        :max="data?.limits.diskMb ?? null"
      />
    </div>
  </section>
</template>
