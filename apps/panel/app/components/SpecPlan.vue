<script setup lang="ts">
export interface PlanChange {
  area: 'content' | 'settings' | 'properties' | 'backups' | 'schedules'
  action: 'add' | 'update' | 'remove' | 'reinstall' | 'set'
  label: string
  from?: string
  to?: string
  note?: string
}
export interface PlanView {
  id: string
  server: string
  changes: PlanChange[]
  problems: string[]
  /** Older plans kept from before warnings existed may not have them. */
  warnings?: string[]
  restart: boolean
  backup: boolean
  downloadBytes: number
  unmanaged: string[]
}

/** Shows what applying a spec would do, grouped the way people think about it. */
const props = defineProps<{ plan: PlanView }>()

const AREAS = [
  { key: 'content', title: 'Content' },
  { key: 'settings', title: 'Settings' },
  { key: 'properties', title: 'server.properties' },
  { key: 'backups', title: 'Backups' },
  { key: 'schedules', title: 'Schedules' },
] as const

const groups = computed(() =>
  AREAS.map((a) => ({ ...a, items: props.plan.changes.filter((c) => c.area === a.key) })).filter(
    (g) => g.items.length,
  ),
)

const ACTIONS = {
  add: { icon: 'i-lucide-plus', color: 'text-success', word: 'Add' },
  update: { icon: 'i-lucide-arrow-up', color: 'text-info', word: 'Update' },
  remove: { icon: 'i-lucide-minus', color: 'text-error', word: 'Remove' },
  reinstall: { icon: 'i-lucide-rotate-ccw', color: 'text-warning', word: 'Reinstall' },
  set: { icon: 'i-lucide-pencil', color: 'text-info', word: 'Change' },
} as const
</script>

<template>
  <div class="space-y-4">
    <UAlert
      v-for="p in plan.problems"
      :key="p"
      color="error"
      variant="subtle"
      icon="i-lucide-octagon-alert"
      :title="p"
    />
    <UAlert
      v-for="w in plan.warnings ?? []"
      :key="w"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="w"
    />

    <p v-if="!plan.changes.length && !plan.problems.length" class="text-sm text-muted">
      Nothing to change: the server already matches this spec.
    </p>

    <div v-if="plan.changes.length" class="flex flex-wrap gap-2">
      <UBadge v-if="plan.backup" color="neutral" variant="subtle" icon="i-lucide-archive">
        Takes a backup first
      </UBadge>
      <UBadge v-if="plan.restart" color="warning" variant="subtle" icon="i-lucide-rotate-cw">
        Restarts the server if it's running
      </UBadge>
      <UBadge v-if="plan.downloadBytes" color="neutral" variant="subtle" icon="i-lucide-download">
        {{ humanBytes(plan.downloadBytes) }} to download
      </UBadge>
    </div>

    <section v-for="g in groups" :key="g.key" class="space-y-1.5">
      <h3 class="text-xs font-semibold tracking-wide text-muted uppercase">{{ g.title }}</h3>
      <ul class="divide-y divide-default rounded-md border border-default">
        <li v-for="(c, i) in g.items" :key="i" class="flex items-start gap-3 px-3 py-2 text-sm">
          <UIcon
            :name="ACTIONS[c.action].icon"
            class="mt-0.5 size-4 shrink-0"
            :class="ACTIONS[c.action].color"
          />
          <div class="min-w-0 flex-1">
            <p>
              <span class="sr-only">{{ ACTIONS[c.action].word }}: </span>
              <span class="font-medium">{{ c.label }}</span>
              <span v-if="c.from !== undefined || c.to !== undefined" class="text-muted">
                <template v-if="c.from !== undefined">
                  <span class="font-mono">{{ c.from || '(empty)' }}</span>
                </template>
                <template v-if="c.from !== undefined && c.to !== undefined"> → </template>
                <template v-if="c.to !== undefined">
                  <span class="font-mono">{{ c.to || '(empty)' }}</span>
                </template>
              </span>
            </p>
            <p v-if="c.note" class="text-xs text-dimmed">{{ c.note }}</p>
          </div>
        </li>
      </ul>
    </section>

    <details v-if="plan.unmanaged.length" class="text-sm">
      <summary class="cursor-pointer text-muted">
        {{ plan.unmanaged.length }} file{{ plan.unmanaged.length === 1 ? '' : 's' }} added by hand,
        left alone
      </summary>
      <ul class="mt-2 space-y-0.5 pl-4 font-mono text-xs text-muted">
        <li v-for="u in plan.unmanaged" :key="u">{{ u }}</li>
      </ul>
    </details>
  </div>
</template>
