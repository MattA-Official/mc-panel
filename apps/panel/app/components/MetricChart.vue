<script setup lang="ts">
/**
 * One measure over time as a thin line with a soft fill. Missing samples (a stopped
 * server) break the line rather than dropping to zero. Hover or tap for the value.
 */
const props = defineProps<{
  label: string
  points: { at: number; value: number | null }[]
  format: (v: number) => string
  /** Top of the scale. Defaults to a little above the highest value. */
  max?: number | null
  /** A dashed reference line, such as the 50 ms tick budget. */
  target?: { value: number; label: string }
  /** What the latest value is called, e.g. "now" or "peak". */
  emptyText?: string
}>()

const HEIGHT = 96
const PAD_TOP = 8
const box = ref<HTMLElement>()
const width = ref(300)
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(([e]) => (width.value = Math.max(100, e!.contentRect.width)))
  if (box.value) observer.observe(box.value)
})
onBeforeUnmount(() => observer?.disconnect())

const values = computed(() => props.points.map((p) => p.value))
const known = computed(() => values.value.filter((v): v is number => v !== null))
const latest = computed(() => {
  for (let i = values.value.length - 1; i >= 0; i--) if (values.value[i] !== null) return i
  return -1
})
const top = computed(() => {
  const highest = Math.max(0, ...known.value, props.target?.value ?? 0)
  const max = props.max ?? 0
  return Math.max(max, highest * 1.15, 1)
})
const x = (i: number) =>
  props.points.length <= 1 ? 0 : (i / (props.points.length - 1)) * width.value
const y = (v: number) => PAD_TOP + (1 - v / top.value) * (HEIGHT - PAD_TOP)

/** Each unbroken run of samples, as a line path and a filled area path. */
const runs = computed(() => {
  const out: { line: string; area: string; dot: { cx: number; cy: number } | null }[] = []
  let run: [number, number][] = []
  const flush = () => {
    if (!run.length) return
    const line = run
      .map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`)
      .join('')
    const area = `${line}L${run.at(-1)![0].toFixed(1)},${HEIGHT}L${run[0]![0].toFixed(1)},${HEIGHT}Z`
    out.push({ line, area, dot: run.length === 1 ? { cx: run[0]![0], cy: run[0]![1] } : null })
    run = []
  }
  values.value.forEach((v, i) => (v === null ? flush() : run.push([x(i), y(v)])))
  flush()
  return out
})

const hover = ref<number | null>(null)
function onMove(e: PointerEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const n = props.points.length
  if (!n) return
  hover.value = Math.min(
    n - 1,
    Math.max(0, Math.round(((e.clientX - rect.left) / rect.width) * (n - 1))),
  )
}
const shown = computed(() => hover.value ?? latest.value)
const shownPoint = computed(() => (shown.value >= 0 ? props.points[shown.value] : undefined))

const when = (at: number) =>
  new Date(at * 1000).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
const spanLabel = computed(() => {
  const first = props.points[0]
  const last = props.points.at(-1)
  if (!first || !last) return ''
  const hours = Math.round((last.at - first.at) / 3600)
  return hours <= 1
    ? '1 hour ago'
    : hours < 48
      ? `${hours} hours ago`
      : `${Math.round(hours / 24)} days ago`
})
const summary = computed(() => {
  if (!known.value.length) return `${props.label}: no samples in this range`
  const max = Math.max(...known.value)
  const min = Math.min(...known.value)
  return `${props.label}: between ${props.format(min)} and ${props.format(max)}${
    latest.value >= 0 ? `, latest ${props.format(values.value[latest.value]!)}` : ''
  }`
})
</script>

<template>
  <figure class="rounded-lg border border-default p-4">
    <figcaption class="flex items-baseline justify-between gap-2">
      <span class="text-sm font-medium">{{ label }}</span>
      <span class="text-xs text-muted tabular-nums">
        <template v-if="shownPoint && shownPoint.value !== null">
          <span class="text-base font-medium text-default">{{ format(shownPoint.value) }}</span>
          · {{ hover === null ? 'latest' : when(shownPoint.at) }}
        </template>
        <template v-else-if="shownPoint">{{ when(shownPoint.at) }} · not running</template>
        <template v-else>{{ emptyText ?? 'No samples yet' }}</template>
      </span>
    </figcaption>
    <div
      ref="box"
      class="relative mt-3 touch-none"
      :style="{ height: `${HEIGHT}px` }"
      @pointermove="onMove"
      @pointerdown="onMove"
      @pointerleave="hover = null"
    >
      <svg
        :width="width"
        :height="HEIGHT"
        class="block overflow-visible"
        role="img"
        :aria-label="summary"
      >
        <line :x1="0" :x2="width" :y1="HEIGHT" :y2="HEIGHT" class="stroke-[var(--ui-border)]" />
        <line
          :x1="0"
          :x2="width"
          :y1="PAD_TOP"
          :y2="PAD_TOP"
          class="stroke-[var(--ui-border)]"
          stroke-dasharray="2 4"
        />
        <template v-if="target">
          <line
            :x1="0"
            :x2="width"
            :y1="y(target.value)"
            :y2="y(target.value)"
            class="stroke-[var(--ui-text-muted)]"
            stroke-dasharray="4 4"
          />
        </template>
        <g v-for="(r, i) in runs" :key="i">
          <path :d="r.area" class="fill-[var(--ui-primary)] opacity-15" />
          <path
            :d="r.line"
            fill="none"
            class="stroke-[var(--ui-primary)]"
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
          <circle
            v-if="r.dot"
            :cx="r.dot.cx"
            :cy="r.dot.cy"
            r="3"
            class="fill-[var(--ui-primary)]"
          />
        </g>
        <g v-if="hover !== null">
          <line
            :x1="x(hover)"
            :x2="x(hover)"
            :y1="0"
            :y2="HEIGHT"
            class="stroke-[var(--ui-text-muted)]"
          />
          <circle
            v-if="values[hover] !== null"
            :cx="x(hover)"
            :cy="y(values[hover]!)"
            r="4"
            stroke-width="2"
            class="fill-[var(--ui-primary)] stroke-[var(--ui-bg-elevated)]"
          />
        </g>
      </svg>
      <span
        :style="{ top: `${PAD_TOP}px` }"
        class="pointer-events-none absolute left-0 -translate-y-1/2 bg-default pr-1 text-[11px] text-muted tabular-nums"
      >
        {{ format(top) }}
      </span>
      <span
        v-if="target"
        class="pointer-events-none absolute right-0 -translate-y-full bg-default pl-1 text-[11px] text-muted"
        :style="{ top: `${y(target.value)}px` }"
      >
        {{ target.label }}
      </span>
    </div>
    <div class="mt-1 flex justify-between text-[11px] text-muted">
      <span>{{ spanLabel }}</span>
      <span>now</span>
    </div>
  </figure>
</template>
