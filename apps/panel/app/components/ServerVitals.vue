<script setup lang="ts">
/**
 * A running server's tick time, memory and CPU on its overview card, with the last hour of
 * tick time as a line. Each figure has a shape and a word as well as a colour, and says why
 * on hover. Opens the full charts.
 */
import type { Figure, Level, Vitals } from '#shared/vitals'

const props = defineProps<{ vitals: Vitals; to: string | Record<string, unknown> }>()

const LOOK: Record<Level, { mark: string; word: string; text: string; stroke: string }> = {
  ok: { mark: '●', word: 'fine', text: 'text-success', stroke: 'var(--ui-success)' },
  busy: { mark: '▲', word: 'busy', text: 'text-warning', stroke: 'var(--ui-warning)' },
  struggling: { mark: '■', word: 'struggling', text: 'text-error', stroke: 'var(--ui-error)' },
}

const gb = (mb: number) => (mb / 1024).toFixed(1)
const figures = computed(() => {
  const { tick, memory, cpu } = props.vitals
  const show = (f: Figure, text: (v: number) => string) => (f.value === null ? '–' : text(f.value))
  return [
    {
      label: 'Tick',
      figure: tick,
      text: show(tick, (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`),
    },
    {
      label: 'Memory',
      figure: memory,
      text: show(memory, (v) => `${gb(v)}/${gb(memory.limitMb)} GB`),
    },
    { label: 'CPU', figure: cpu, text: show(cpu, (v) => `${Math.round(v)}%`) },
  ]
})

/** The tick-time line: 60 minutes across, 0 to at least 60 ms up, with 50 ms marked. */
const W = 200
const H = 28
const top = computed(() => Math.max(60, ...props.vitals.spark.map((v) => v ?? 0)))
const y = (ms: number) => H - 2 - (ms / top.value) * (H - 4)
const line = computed(() => {
  const step = W / (props.vitals.spark.length - 1)
  const runs: string[] = []
  let run: string[] = []
  props.vitals.spark.forEach((v, i) => {
    if (v === null) {
      if (run.length) runs.push(run.join(' '))
      run = []
    } else run.push(`${(i * step).toFixed(1)},${y(v).toFixed(1)}`)
  })
  if (run.length) runs.push(run.join(' '))
  return runs
})
</script>

<template>
  <NuxtLink
    :to="to"
    class="block rounded-md border border-default px-3 py-2 transition-colors hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary"
    aria-label="Open performance charts"
    data-e2e="server-vitals"
  >
    <dl class="grid grid-cols-3 gap-2 text-sm">
      <UTooltip v-for="f in figures" :key="f.label" :text="f.figure.reason">
        <div class="min-w-0">
          <dt class="text-xs text-muted">{{ f.label }}</dt>
          <dd
            class="truncate font-mono tabular-nums"
            :class="f.figure.value === null ? 'text-muted' : LOOK[f.figure.level].text"
          >
            <span aria-hidden="true">{{ LOOK[f.figure.level].mark }}</span>
            {{ f.text }}
            <span class="sr-only">, {{ LOOK[f.figure.level].word }}</span>
          </dd>
        </div>
      </UTooltip>
    </dl>
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="none"
      class="mt-1 h-7 w-full"
      role="img"
      aria-label="Tick time over the last hour"
    >
      <line
        :x1="0"
        :x2="W"
        :y1="y(50)"
        :y2="y(50)"
        stroke="currentColor"
        class="text-dimmed"
        stroke-dasharray="3 3"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
      <polyline
        v-for="(points, i) in line"
        :key="i"
        :points="points"
        fill="none"
        :stroke="LOOK[vitals.tick.level].stroke"
        stroke-width="1.5"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  </NuxtLink>
</template>
