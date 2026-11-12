<script setup lang="ts">
import { anchorSelector } from '@flytower/docs-layer/anchors'

/**
 * Lights up the control Help's "Show me" points at (#270): a ring round it with the rest of
 * the page dimmed, and a bar with its name and a way back to the help page. The control
 * stays usable. Escape, a click anywhere, or leaving the page ends it.
 */
const { spotlight, back, picking, pick, backToHelp } = useShowMe()
const now = useRouter().currentRoute
const can = useCan()

const rect = ref<{ top: number; left: number; width: number; height: number } | null>(null)
const missing = ref<string | null>(null)
let element: HTMLElement | null = null
let frame = 0

const visible = (el: Element) => el.getClientRects().length > 0
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The control as drawn now: pages redraw while they load, replacing the element we found. */
function current(id: string) {
  return [...document.querySelectorAll<HTMLElement>(anchorSelector(id))].find(visible) ?? null
}

function track() {
  if (!element?.isConnected) {
    element = spotlight.value ? current(spotlight.value.id) : null
    if (!element) {
      rect.value = null
      if (spotlight.value) void find(spotlight.value.seq)
      return
    }
  }
  const r = element.getBoundingClientRect()
  const pad = 6
  rect.value = {
    top: r.top - pad,
    left: r.left - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  }
  frame = requestAnimationFrame(track)
}

function end() {
  cancelAnimationFrame(frame)
  element = null
  rect.value = null
  missing.value = null
  spotlight.value = null
}

/** Finds the control, waiting for its page and section to draw, for up to three seconds. */
async function find(seq: number) {
  const target = spotlight.value
  if (!target) return
  cancelAnimationFrame(frame)
  rect.value = null
  missing.value = null
  for (let tries = 0; tries < 30; tries++) {
    if (spotlight.value?.seq !== seq) return
    const el = current(target.id)
    if (el) {
      element = el
      el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
      if (el.matches('button, a[href], input, select, textarea')) el.focus({ preventScroll: true })
      track()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  missing.value =
    target.need && !can(target.need as Parameters<typeof can>[0], target.server)
      ? `Your role can't use ${target.label}, so it isn't shown to you.`
      : target.shownWhen
        ? `${target.label} shows once ${target.shownWhen}.`
        : `${target.label} isn't showing here just now. It may be switched off, or need something set up first.`
}

watch(
  () => spotlight.value?.seq,
  (seq) => seq && void find(seq),
  { flush: 'post' },
)
// Leaving the page ends it; a section opening (a #hash) doesn't.
watch(
  () => now.value.path,
  (path) => spotlight.value && spotlight.value.path !== path && end(),
)

const bar = useTemplateRef<HTMLElement>('bar')
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && spotlight.value) end()
}
function onPointer(e: PointerEvent) {
  if (!spotlight.value || bar.value?.contains(e.target as Node)) return
  end()
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointerdown', onPointer, true)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointerdown', onPointer, true)
})

const pickOpen = computed({
  get: () => !!picking.value,
  set: (open) => !open && (picking.value = null),
})
</script>

<template>
  <div
    v-if="rect"
    class="doc-spotlight pointer-events-none fixed z-[60] rounded-lg"
    :style="{
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    }"
    data-e2e="doc-spotlight"
    aria-hidden="true"
  />
  <div
    v-if="spotlight"
    ref="bar"
    class="fixed inset-x-4 bottom-4 z-[61] mx-auto flex max-w-md items-center gap-2 rounded-lg border border-default bg-default p-2 pl-3 shadow-lg"
    role="status"
    aria-live="polite"
    data-e2e="doc-spotlight-bar"
  >
    <UIcon
      :name="missing ? 'i-lucide-circle-help' : 'i-lucide-locate-fixed'"
      class="size-5 shrink-0"
      :class="missing ? 'text-muted' : 'text-primary'"
    />
    <p class="min-w-0 flex-1 text-sm">
      <template v-if="missing">{{ missing }}</template>
      <template v-else-if="rect"
        >This is <span class="font-semibold">{{ spotlight.label }}</span
        >.</template
      >
      <template v-else>Finding {{ spotlight.label }}…</template>
    </p>
    <UButton
      v-if="back?.panel || back?.route"
      label="Back to help"
      icon="i-lucide-undo-2"
      size="sm"
      color="neutral"
      variant="ghost"
      @click="backToHelp"
    />
    <UButton
      icon="i-lucide-x"
      size="sm"
      color="neutral"
      variant="ghost"
      aria-label="Close"
      @click="end"
    />
  </div>

  <UModal
    v-model:open="pickOpen"
    title="Which server?"
    description="Show it on this server's page."
  >
    <template #body>
      <ul class="space-y-1">
        <li v-for="s in picking?.servers" :key="s.name">
          <UButton
            :label="s.displayName"
            :trailing-icon="'i-lucide-chevron-right'"
            color="neutral"
            variant="ghost"
            block
            class="justify-between"
            @click="pick(s.name)"
          />
        </li>
      </ul>
    </template>
  </UModal>
</template>

<style scoped>
.doc-spotlight {
  outline: 2px solid var(--ui-primary);
  box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.35);
}
@media (prefers-reduced-motion: no-preference) {
  .doc-spotlight {
    animation: doc-spotlight-pulse 1.4s ease-out 3;
  }
}
@keyframes doc-spotlight-pulse {
  0% {
    outline-offset: 0;
    outline-color: var(--ui-primary);
  }
  70% {
    outline-offset: 8px;
    outline-color: transparent;
  }
  100% {
    outline-offset: 0;
    outline-color: var(--ui-primary);
  }
}
</style>
