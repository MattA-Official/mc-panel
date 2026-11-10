<script setup lang="ts">
/**
 * A tab's sections on one page, each a bar that opens and closes. Used by Settings and World.
 *
 * - Which sections are open is remembered per tab in this browser.
 * - A link ending `#<id>` opens that section and scrolls to it, so links elsewhere land on it.
 * - A closed section isn't rendered, so its data loads only when it's opened.
 * - Each section can need a permission to change things; without it the section says so and
 *   its fields are disabled. The server checks every request anyway.
 */
import type { Permission } from '#shared/permissions'

export interface CollapsibleSection {
  id: string
  label: string
  icon: string
  /** What's inside, shown under the label. */
  description: string
  /** A short state shown on the bar, like "Public page on". */
  summary?: string | null
  /** What changing things here needs, and what to say when that's missing. */
  need?: { permission: Permission; text: string }
}

const props = defineProps<{
  sections: CollapsibleSection[]
  /** Remembers what's open, e.g. "settings". */
  storageKey: string
  /** Open the first time, before anything is remembered. */
  defaultOpen: string[]
}>()

const route = useRoute()
const can = useCan()
const server = computed(() => String(route.params.name))
const storeKey = computed(() => `flytower:sections:${props.storageKey}`)

function remembered(): string[] | null {
  try {
    const raw = localStorage.getItem(storeKey.value)
    return raw ? (JSON.parse(raw) as string[]) : null
  } catch {
    return null
  }
}

const open = ref<Set<string>>(new Set(props.defaultOpen))
onMounted(() => {
  const saved = remembered()
  if (saved) open.value = new Set(saved.filter((id) => props.sections.some((s) => s.id === id)))
  reveal(route.hash)
})
watch(
  () => route.hash,
  (hash) => reveal(hash),
)

/** Opens the section a `#<id>` link points at and scrolls to it. */
async function reveal(hash: string) {
  const id = hash.replace(/^#/, '')
  if (!props.sections.some((s) => s.id === id)) return
  setOpen(id, true)
  await nextTick()
  document.getElementById(`section-${id}`)?.scrollIntoView({ block: 'start' })
}

function setOpen(id: string, value: boolean) {
  const next = new Set(open.value)
  if (value) next.add(id)
  else next.delete(id)
  open.value = next
  try {
    localStorage.setItem(storeKey.value, JSON.stringify([...next]))
  } catch {
    // Private windows can refuse storage; the sections still work.
  }
}

const readOnly = (s: CollapsibleSection) =>
  s.need && !can(s.need.permission, server.value) ? s.need.text : null
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-3">
    <UCollapsible
      v-for="s in sections"
      :id="`section-${s.id}`"
      :key="s.id"
      :open="open.has(s.id)"
      class="scroll-mt-4 rounded-lg border border-default"
      :ui="{ content: 'border-t border-default p-4 sm:p-5' }"
      :data-e2e="`section-${s.id}`"
      @update:open="(v: boolean) => setOpen(s.id, v)"
    >
      <template #default="{ open: isOpen }">
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left hover:bg-elevated/50 focus-visible:outline-2 focus-visible:outline-primary"
        >
          <UIcon :name="s.icon" class="size-5 shrink-0 text-muted" />
          <span class="min-w-0 flex-1">
            <span class="block font-semibold">{{ s.label }}</span>
            <span class="block truncate text-sm text-muted">{{ s.description }}</span>
          </span>
          <span v-if="s.summary && !isOpen" class="hidden text-sm text-muted sm:block">
            {{ s.summary }}
          </span>
          <UIcon
            name="i-lucide-chevron-down"
            class="size-5 shrink-0 text-muted transition-transform"
            :class="isOpen ? 'rotate-180' : ''"
          />
        </button>
      </template>
      <template #content>
        <UAlert
          v-if="readOnly(s)"
          class="mb-4"
          color="neutral"
          variant="subtle"
          icon="i-lucide-eye"
          title="View only"
          :description="readOnly(s)!"
          data-e2e="read-only"
        />
        <fieldset :disabled="!!readOnly(s)" class="contents">
          <slot :name="s.id" />
        </fieldset>
      </template>
    </UCollapsible>
    <slot name="after" />
  </div>
</template>
