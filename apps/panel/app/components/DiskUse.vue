<script setup lang="ts">
/**
 * Where the disk has gone: one bar split by server, then the rest of the system, then free
 * space, and a table of each server's share. Figures come from the background walk.
 */
import { DISK_GROUPS, DISK_URGENT, DISK_WARN } from '~~/shared/disk'

const { data, refresh } = useDiskStatus()
const toast = useToast()

/** Servers get the first six colours in a fixed order; any more share the seventh. */
const SLOTS = 6
const MB = 1024 * 1024

const servers = computed(() => [...(data.value?.servers ?? [])].sort((a, b) => b.bytes - a.bytes))

interface Segment {
  key: string
  label: string
  bytes: number
  swatch: string
}

const segments = computed<Segment[]>(() => {
  const d = data.value
  if (!d?.totalMb || d.usedMb == null) return []
  // Colour follows the server (alphabetical), not its rank, so it doesn't change as sizes do.
  const alpha = [...servers.value].map((s) => s.server).sort()
  const shown = servers.value.filter((s) => alpha.indexOf(s.server) < SLOTS)
  const rest = servers.value.filter((s) => alpha.indexOf(s.server) >= SLOTS)
  const out: Segment[] = shown.map((s) => ({
    key: s.server,
    label: s.displayName,
    bytes: s.bytes,
    swatch: `disk-s${alpha.indexOf(s.server) + 1}`,
  }))
  if (rest.length) {
    out.push({
      key: '+others',
      label: `${rest.length} more servers`,
      bytes: rest.reduce((a, s) => a + s.bytes, 0),
      swatch: 'disk-s7',
    })
  }
  const shared = (d.shared?.imports ?? 0) + (d.shared?.archive ?? 0)
  if (shared > 0) {
    out.push({
      key: '+shared',
      label: 'Imports and archives',
      bytes: shared,
      swatch: 'disk-shared',
    })
  }
  const counted = out.reduce((a, s) => a + s.bytes, 0)
  const system = Math.max(0, d.usedMb * MB - counted)
  out.push({
    key: '+system',
    label: 'System and other files',
    bytes: system,
    swatch: 'disk-system',
  })
  return out
})

const totalBytes = computed(() => (data.value?.totalMb ?? 0) * MB)
const width = (bytes: number) =>
  totalBytes.value ? `${Math.max(0.5, (bytes / totalBytes.value) * 100)}%` : '0%'
const free = computed(() =>
  data.value?.totalMb != null && data.value.usedMb != null
    ? humanMb(data.value.totalMb - data.value.usedMb)
    : null,
)

const color = computed(() =>
  data.value?.level === 'urgent'
    ? 'error'
    : data.value?.level === 'warning'
      ? 'warning'
      : 'neutral',
)

const largest = (groups: Record<keyof typeof DISK_GROUPS, number>) => {
  const [g] = (Object.entries(groups) as [keyof typeof DISK_GROUPS, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
  return g ? `${DISK_GROUPS[g[0]]}, ${humanBytes(g[1])}` : '—'
}

const measuring = ref(false)
async function measureNow() {
  measuring.value = true
  try {
    await $fetch('/api/system/disk/refresh', { method: 'POST' })
    await refresh()
  } catch (err) {
    toast.add({
      title: "Couldn't measure the disk",
      description: errorMessage(err),
      color: 'error',
    })
  } finally {
    measuring.value = false
  }
}
</script>

<template>
  <div v-if="data" class="space-y-4" data-e2e="disk-use">
    <div class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
      <span class="font-medium">Disk</span>
      <span v-if="data.percent !== null" class="text-muted tabular-nums">
        {{ humanMb(data.usedMb!) }} of {{ humanMb(data.totalMb!) }} used ·
        <span :class="{ 'text-warning': color === 'warning', 'text-error': color === 'error' }">
          {{ Math.round(data.percent) }}% full, {{ free }} free
        </span>
      </span>
      <span v-else class="text-muted">Waiting for the first reading…</span>
    </div>

    <div
      v-if="segments.length"
      class="flex h-4 w-full gap-0.5 overflow-hidden rounded-full bg-elevated"
      role="img"
      :aria-label="`Disk ${Math.round(data.percent ?? 0)}% full`"
    >
      <UTooltip
        v-for="s in segments"
        :key="s.key"
        :text="`${s.label}: ${humanBytes(s.bytes)}`"
        :content="{ side: 'top' }"
      >
        <div :class="['h-full shrink-0', s.swatch]" :style="{ width: width(s.bytes) }" />
      </UTooltip>
    </div>

    <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      <li v-for="s in segments" :key="s.key" class="flex items-center gap-1.5">
        <span :class="['size-2.5 rounded-sm', s.swatch]" />
        {{ s.label }} <span class="tabular-nums">{{ humanBytes(s.bytes) }}</span>
      </li>
      <li v-if="free" class="flex items-center gap-1.5">
        <span class="size-2.5 rounded-sm bg-elevated ring-1 ring-default" />
        Free <span class="tabular-nums">{{ free }}</span>
      </li>
    </ul>

    <UAlert
      v-if="data.level !== 'ok'"
      :color="color === 'error' ? 'error' : 'warning'"
      variant="subtle"
      icon="i-lucide-hard-drive"
      :title="
        data.level === 'urgent'
          ? `Over ${DISK_URGENT}%: scheduled backups are paused`
          : `Over ${DISK_WARN}%: time to free up some space`
      "
      description="Old backups and world exports are the usual culprits. Lower how many backups each server keeps, or delete exports you've downloaded."
    />

    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-muted">
          <tr>
            <th class="py-1.5 pe-4 font-medium">Server</th>
            <th class="py-1.5 pe-4 text-right font-medium">Size</th>
            <th class="hidden py-1.5 pe-4 font-medium sm:table-cell">Largest part</th>
            <th class="py-1.5 font-medium"><span class="sr-only">Links</span></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <tr v-for="s in servers" :key="s.server">
            <td class="py-1.5 pe-4">{{ s.displayName }}</td>
            <td class="py-1.5 pe-4 text-right whitespace-nowrap tabular-nums">
              {{ humanBytes(s.bytes) }}
            </td>
            <td class="hidden py-1.5 pe-4 text-muted sm:table-cell">
              {{ largest(s.groups) }}
              <UTooltip v-if="s.unreadable" text="Some files couldn't be read, so this is a floor">
                <UIcon name="i-lucide-circle-alert" class="ms-1 align-middle text-warning" />
              </UTooltip>
            </td>
            <td class="py-1.5 text-right whitespace-nowrap">
              <UButton
                :to="`/servers/${s.server}/settings/maintenance`"
                label="Details"
                size="xs"
                color="neutral"
                variant="ghost"
              />
              <UButton
                :to="`/servers/${s.server}/world`"
                label="Backups"
                size="xs"
                color="neutral"
                variant="ghost"
              />
            </td>
          </tr>
          <tr v-if="data.shared && data.shared.imports + data.shared.archive > 0">
            <td class="py-1.5 pe-4">Imports and archives</td>
            <td class="py-1.5 pe-4 text-right whitespace-nowrap tabular-nums">
              {{ humanBytes(data.shared.imports + data.shared.archive) }}
            </td>
            <td class="hidden py-1.5 pe-4 text-muted sm:table-cell" colspan="2">
              Uploads waiting to be imported, and deleted servers kept so they can be restored
            </td>
          </tr>
          <tr v-if="!servers.length">
            <td colspan="4" class="py-3 text-center text-muted">
              {{ data.measuring ? 'Measuring…' : 'No servers measured yet.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
      <span>
        {{
          data.measuredAt
            ? `Measured ${formatDateTime(data.measuredAt)}. Updated after backups, restores and imports, and every hour.`
            : 'Not measured yet.'
        }}
      </span>
      <UButton
        icon="i-lucide-refresh-cw"
        label="Measure now"
        size="xs"
        color="neutral"
        variant="outline"
        :loading="measuring || data.measuring"
        @click="measureNow"
      />
    </div>
  </div>
</template>

<style>
/* Categorical slots in a fixed order; dark mode uses its own steps of the same hues. */
.disk-s1 {
  background: #2a78d6;
}
.disk-s2 {
  background: #1baf7a;
}
.disk-s3 {
  background: #e87ba4;
}
.disk-s4 {
  background: #6250d6;
}
.disk-s5 {
  background: #eb6834;
}
.disk-s6 {
  background: #008300;
}
.disk-s7 {
  background: #eda100;
}
.disk-shared {
  background: var(--ui-text-dimmed);
}
.disk-system {
  background: var(--ui-text-muted);
}
.dark .disk-s1 {
  background: #3987e5;
}
.dark .disk-s2 {
  background: #199e70;
}
.dark .disk-s3 {
  background: #d55181;
}
.dark .disk-s4 {
  background: #9085e9;
}
.dark .disk-s5 {
  background: #d95926;
}
.dark .disk-s7 {
  background: #c98500;
}
</style>
