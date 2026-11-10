<script setup lang="ts">
/** What this server has on disk, split into its world, backups, logs and so on. */
import { DISK_GROUPS, type DiskGroup } from '~~/shared/disk'

const { server } = useServerContext()
const name = computed(() => server.value?.name ?? '')
const { data } = await useFetch(() => `/api/servers/${name.value}/disk`, { watch: [name] })

const rows = computed(() => {
  const u = data.value?.usage
  if (!u) return []
  return (Object.keys(DISK_GROUPS) as DiskGroup[]).map((g, i) => ({
    group: g,
    label: DISK_GROUPS[g],
    bytes: u.groups[g],
    swatch: `disk-g${i + 1}`,
  }))
})
const total = computed(() => data.value?.usage?.bytes ?? 0)
const width = (bytes: number) => (total.value ? `${(bytes / total.value) * 100}%` : '0%')
const ofDisk = computed(() => {
  const t = data.value?.totalMb
  return t ? Math.round((total.value / (t * 1024 * 1024)) * 1000) / 10 : null
})
const summary = computed(() =>
  ofDisk.value === null
    ? humanBytes(total.value)
    : `${humanBytes(total.value)} · ${ofDisk.value}% of the disk`,
)
</script>

<template>
  <section class="rounded-lg border border-default p-5" data-e2e="server-disk">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 class="text-base font-semibold">Disk use</h2>
      <span v-if="data?.usage" class="text-sm text-muted tabular-nums">
        {{ summary }}
      </span>
    </div>
    <div v-if="data?.usage" class="mt-4 space-y-4">
      <div
        class="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-elevated"
        role="img"
        :aria-label="`${humanBytes(total)} on disk`"
      >
        <template v-for="r in rows" :key="r.group">
          <UTooltip v-if="r.bytes > 0" :text="`${r.label}: ${humanBytes(r.bytes)}`">
            <div :class="['h-full shrink-0', r.swatch]" :style="{ width: width(r.bytes) }" />
          </UTooltip>
        </template>
      </div>
      <dl class="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5 text-sm">
        <template v-for="r in rows" :key="r.group">
          <span :class="['size-2.5 rounded-sm', r.swatch]" />
          <dt>{{ r.label }}</dt>
          <dd class="text-right text-muted tabular-nums">
            {{ r.bytes ? humanBytes(r.bytes) : '—' }}
          </dd>
        </template>
      </dl>
      <p v-if="data.usage.unreadable" class="text-xs text-warning">
        Flytower couldn't read {{ data.usage.unreadable }}
        {{ data.usage.unreadable === 1 ? 'item' : 'items' }} in this server's folders, so the real
        figure is a little higher.
      </p>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs text-muted">
          Measured {{ formatDateTime(data.usage.measuredAt) }}
        </span>
        <UButton
          :to="`/servers/${name}/backups`"
          label="Manage backups"
          icon="i-lucide-archive"
          size="sm"
          color="neutral"
          variant="outline"
        />
      </div>
    </div>
    <p v-else class="mt-2 text-sm text-muted">
      {{
        data?.measuring ? 'Measuring this server…' : 'Not measured yet. It will be within the hour.'
      }}
    </p>
  </section>
</template>

<style>
.disk-g1 {
  background: #2a78d6;
}
.disk-g2 {
  background: #1baf7a;
}
.disk-g3 {
  background: #e87ba4;
}
.disk-g4 {
  background: #6250d6;
}
.disk-g5 {
  background: #eb6834;
}
.disk-g6 {
  background: var(--ui-text-muted);
}
.dark .disk-g1 {
  background: #3987e5;
}
.dark .disk-g2 {
  background: #199e70;
}
.dark .disk-g3 {
  background: #d55181;
}
.dark .disk-g4 {
  background: #9085e9;
}
.dark .disk-g5 {
  background: #d95926;
}
</style>
