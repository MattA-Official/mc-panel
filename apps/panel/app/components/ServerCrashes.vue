<script setup lang="ts">
interface ServerEvent {
  id: number
  at: string
  kind: ServerEventKind
  cause: string | null
  result: string | null
  exitStatus: number | null
  crashReport: string | null
  logTail: string[]
  dismissed: boolean
}

const { server, health } = useServerContext()
const { data: events, refresh } = await useFetch<ServerEvent[]>(
  () => `/api/servers/${server.value?.name}/events`,
  { default: () => [] },
)
// A new crash while this is open shows up straight away.
watch(
  () => health.value.crash?.id,
  () => refresh(),
)

const LOOK: Record<ServerEventKind, { label: string; icon: string; color: string }> = {
  crash: { label: 'Crashed', icon: 'i-lucide-octagon-alert', color: 'text-error' },
  oom: { label: 'Ran out of memory', icon: 'i-lucide-memory-stick', color: 'text-error' },
  'crash-loop': {
    label: 'Left stopped after crashing',
    icon: 'i-lucide-repeat',
    color: 'text-error',
  },
  unresponsive: { label: 'Stopped responding', icon: 'i-lucide-hourglass', color: 'text-warning' },
  recovered: { label: 'Back to normal', icon: 'i-lucide-circle-check', color: 'text-success' },
}
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
const open = ref<number | null>(null)
</script>

<template>
  <div class="space-y-3" data-e2e="crash-list">
    <UEmpty
      v-if="events.length === 0"
      icon="i-lucide-shield-check"
      title="No crashes in the last 30 days"
      description="Crashes, crash loops and times the server stopped responding are listed here."
    />
    <ul v-else class="divide-y divide-default rounded-lg border border-default">
      <li v-for="e in events" :key="e.id" class="p-3 text-sm">
        <div class="flex items-start gap-3">
          <UIcon
            :name="LOOK[e.kind].icon"
            class="mt-0.5 size-4 shrink-0"
            :class="LOOK[e.kind].color"
          />
          <div class="min-w-0 flex-1">
            <p class="font-medium">{{ LOOK[e.kind].label }}</p>
            <p v-if="e.cause" class="break-words text-muted">{{ e.cause }}</p>
            <p class="text-xs text-dimmed">{{ when(e.at) }}</p>
            <div v-if="e.crashReport || e.logTail.length" class="mt-2 flex flex-wrap gap-2">
              <UButton
                v-if="e.crashReport"
                size="xs"
                icon="i-lucide-file-warning"
                color="neutral"
                variant="outline"
                label="Crash report"
                :to="crashReportLink(server!.name, e.crashReport)"
              />
              <UButton
                v-if="e.logTail.length"
                size="xs"
                icon="i-lucide-scroll-text"
                color="neutral"
                variant="ghost"
                :label="open === e.id ? 'Hide the log' : 'The log before it'"
                @click="open = open === e.id ? null : e.id"
              />
            </div>
            <div
              v-if="open === e.id"
              class="mt-2 max-h-80 overflow-y-auto rounded-md border border-default bg-[#0b0e14] px-3 py-2 font-mono text-xs leading-relaxed"
            >
              <div
                v-for="(line, i) in e.logTail"
                :key="i"
                class="break-words whitespace-pre-wrap"
                :class="logTone(line)"
              >
                {{ line }}
              </div>
            </div>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
