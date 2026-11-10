<script setup lang="ts">
import type { ScheduleSettings } from '~/components/BackupSchedule.vue'

interface BackupRow {
  id: number
  file: string
  bytes: number
  kind: 'manual' | 'scheduled' | 'safety'
  note: string | null
  kept: boolean
  createdAt: string
  local: boolean
  offsite: {
    state: 'pending' | 'uploading' | 'done' | 'failed'
    error: string | null
    at: string | null
  } | null
}

const { server, refresh: refreshServer } = useServerContext()
const name = computed(() => server.value?.name ?? '')
const toast = useToast()
const withElevation = useElevation()

const { data, refresh } = await useFetch<{
  backups: BackupRow[]
  schedule: ScheduleSettings
  busy: boolean
  offsiteTarget: number | null
}>(() => `/api/servers/${name.value}/backups`)

// Keep an eye on uploads in progress.
const uploading = computed(() =>
  (data.value?.backups ?? []).some(
    (b) => b.offsite && ['pending', 'uploading'].includes(b.offsite.state),
  ),
)
let poll: ReturnType<typeof setInterval> | undefined
watch(
  uploading,
  (on) => {
    clearInterval(poll)
    if (on && import.meta.client) poll = setInterval(() => void refresh(), 5000)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearInterval(poll))

function offsiteBadge(b: BackupRow) {
  if (!b.offsite) return null
  switch (b.offsite.state) {
    case 'done':
      return {
        icon: 'i-lucide-cloud-check',
        class: 'text-success',
        label: b.local ? 'Copied off-site' : 'Off-site only: restoring downloads it first',
      }
    case 'failed':
      return {
        icon: 'i-lucide-cloud-alert',
        class: 'text-error',
        label: `Off-site copy failed: ${b.offsite.error ?? 'unknown error'}`,
      }
    default:
      return {
        icon: 'i-lucide-cloud-upload',
        class: 'text-muted animate-pulse',
        label: 'Copying off-site',
      }
  }
}

async function retryUpload(b: BackupRow) {
  try {
    await $fetch(`/api/servers/${name.value}/backups/${b.id}/offsite` as string, { method: 'POST' })
    refresh()
  } catch (err) {
    toast.add({ title: "Couldn't retry", description: errorMessage(err), color: 'error' })
  }
}

const job = ref<{ id: number; title: string; steps: readonly string[] } | null>(null)
const finished = ref<JobEvent | null>(null)
function onFinished(e: JobEvent) {
  finished.value = e
  refresh()
  refreshServer()
}

// Back up now. On a nearly full disk, say so first: a backup could fill it.
const { data: disk, refresh: refreshDisk } = useDiskStatus()
const noteOpen = ref(false)
watch(noteOpen, (open) => open && void refreshDisk())
useOpenFromQuery('backup', () => (noteOpen.value = true))
const note = ref('')
async function backupNow() {
  noteOpen.value = false
  try {
    const { jobId } = await $fetch<{ jobId: number }>(
      `/api/servers/${name.value}/backups` as string,
      { method: 'POST', body: { note: note.value } },
    )
    finished.value = null
    job.value = { id: jobId, title: 'Backing up', steps: BACKUP_STEPS }
    note.value = ''
  } catch (err) {
    toast.add({ title: "Couldn't start a backup", description: errorMessage(err), color: 'error' })
  }
}

// Restore
const restoring = ref<BackupRow | null>(null)
async function restore() {
  const b = restoring.value
  if (!b) return
  try {
    const { jobId } = await withElevation(() =>
      $fetch<{ jobId: number }>(`/api/servers/${name.value}/backups/${b.id}/restore` as string, {
        method: 'POST',
      }),
    )
    restoring.value = null
    finished.value = null
    job.value = { id: jobId, title: `Restoring ${when(b.createdAt)}`, steps: RESTORE_STEPS }
  } catch (err) {
    toast.add({ title: "Couldn't restore", description: errorMessage(err), color: 'error' })
  }
}

// Keep forever
async function setKept(b: BackupRow, kept: boolean) {
  try {
    await $fetch(`/api/servers/${name.value}/backups/${b.id}` as string, {
      method: 'PATCH',
      body: { kept },
    })
    toast.add({
      title: kept ? 'Kept forever' : 'Retention can delete it again',
      color: 'success',
    })
    refresh()
  } catch (err) {
    toast.add({ title: "Couldn't change it", description: errorMessage(err), color: 'error' })
  }
}

// Delete
const deleting = ref<BackupRow | null>(null)
async function remove() {
  const b = deleting.value
  if (!b) return
  try {
    await withElevation(() =>
      $fetch<unknown>(`/api/servers/${name.value}/backups/${b.id}` as string, { method: 'DELETE' }),
    )
    toast.add({ title: 'Backup deleted', color: 'success' })
    deleting.value = null
    refresh()
  } catch (err) {
    toast.add({ title: "Couldn't delete it", description: errorMessage(err), color: 'error' })
  }
}

function size(n: number) {
  if (n < 1024 ** 2) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}
const when = (iso: string) => formatDateTime(iso)
const kinds = {
  manual: { label: 'Manual', color: 'primary' },
  scheduled: { label: 'Scheduled', color: 'neutral' },
  safety: { label: 'Safety copy', color: 'warning' },
} as const

const running = computed(() => !!job.value && !finished.value)
const count = computed(() => {
  const n = data.value?.backups.length ?? 0
  return n === 1 ? '1 backup' : `${n} backups`
})
const total = computed(() => (data.value?.backups ?? []).reduce((a, b) => a + b.bytes, 0))

function menu(b: BackupRow) {
  return [
    [
      ...(b.local
        ? [
            {
              label: 'Download',
              icon: 'i-lucide-download',
              href: `/api/servers/${name.value}/backups/${b.id}/download`,
              download: b.file,
            },
          ]
        : []),
      ...(b.offsite?.state === 'failed'
        ? [
            {
              label: 'Retry off-site copy',
              icon: 'i-lucide-cloud-upload',
              onSelect: () => retryUpload(b),
            },
          ]
        : []),
      {
        label: 'Restore',
        icon: 'i-lucide-history',
        disabled: running.value,
        onSelect: () => (restoring.value = b),
      },
      b.kept
        ? {
            label: 'Stop keeping forever',
            icon: 'i-lucide-lock-open',
            onSelect: () => setKept(b, false),
          }
        : { label: 'Keep forever', icon: 'i-lucide-lock', onSelect: () => setKept(b, true) },
    ],
    [
      {
        label: 'Delete',
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        disabled: running.value,
        onSelect: () => (deleting.value = b),
      },
    ],
  ]
}
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-6">
    <UCard v-if="job">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="font-semibold">{{ job.title }}</h2>
        <UButton
          v-if="finished"
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          aria-label="Dismiss"
          @click="job = null"
        />
      </div>
      <JobProgress :key="job.id" :job-id="job.id" :steps="job.steps" @finished="onFinished" />
    </UCard>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted">
        {{ count }}<template v-if="total"> · {{ size(total) }}</template
        >. Logs aren't included.
      </p>
      <UButton
        label="Back up now"
        icon="i-lucide-archive"
        :disabled="running || data?.busy"
        @click="noteOpen = true"
      />
    </div>

    <div class="overflow-hidden rounded-lg border border-default">
      <table class="w-full text-sm">
        <thead class="bg-elevated/50 text-left text-xs text-muted">
          <tr>
            <th class="px-3 py-2 font-medium">Taken</th>
            <th class="px-3 py-2 font-medium">Kind</th>
            <th class="hidden px-3 py-2 font-medium md:table-cell">Note</th>
            <th class="px-3 py-2 text-right font-medium">Size</th>
            <th class="w-10"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <tr v-for="b in data?.backups" :key="b.id" class="hover:bg-elevated/40">
            <td class="px-3 py-2 whitespace-nowrap">{{ when(b.createdAt) }}</td>
            <td class="px-3 py-2">
              <div class="flex items-center gap-2">
                <UBadge
                  :label="kinds[b.kind].label"
                  :color="kinds[b.kind].color"
                  variant="subtle"
                  size="sm"
                />
                <UTooltip v-if="b.kept" text="Kept forever: retention never deletes it">
                  <UBadge
                    label="Kept"
                    icon="i-lucide-lock"
                    color="success"
                    variant="subtle"
                    size="sm"
                  />
                </UTooltip>
                <UTooltip v-if="offsiteBadge(b)" :text="offsiteBadge(b)!.label">
                  <UIcon
                    :name="offsiteBadge(b)!.icon"
                    :class="['size-4', offsiteBadge(b)!.class]"
                    :aria-label="offsiteBadge(b)!.label"
                    role="img"
                  />
                </UTooltip>
                <span v-if="!b.local" class="text-xs text-muted">Off-site only</span>
              </div>
            </td>
            <td class="hidden max-w-xs truncate px-3 py-2 text-muted md:table-cell">
              {{ b.note }}
            </td>
            <td class="px-3 py-2 text-right text-muted tabular-nums">{{ size(b.bytes) }}</td>
            <td class="px-1">
              <UDropdownMenu :items="menu(b)">
                <UButton
                  icon="i-lucide-ellipsis"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  :aria-label="`Actions for backup ${when(b.createdAt)}`"
                />
              </UDropdownMenu>
            </td>
          </tr>
          <tr v-if="!data?.backups.length">
            <td colspan="5" class="px-3 py-8 text-center text-muted">
              No backups yet. Make one now, or set a schedule below.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <BackupSchedule v-if="data" :server="name" :schedule="data.schedule" @saved="refresh" />

    <BackupOffsite v-if="data" :server="name" :target="data.offsiteTarget" @saved="refresh" />

    <UModal v-model:open="noteOpen" title="Back up now">
      <template #body>
        <form @submit.prevent="backupNow">
          <UFormField label="Note" hint="Optional">
            <UInput
              v-model="note"
              class="w-full"
              maxlength="200"
              placeholder="Before installing the new mods"
              autofocus
            />
          </UFormField>
          <p class="mt-3 text-sm text-muted">
            Players can stay on. Autosave pauses while the world is copied.
          </p>
          <UAlert
            v-if="disk?.level === 'urgent'"
            class="mt-3"
            color="error"
            variant="subtle"
            icon="i-lucide-hard-drive"
            :title="`The disk is ${Math.round(disk.percent ?? 0)}% full`"
            description="A backup needs room, and if the disk fills up the server can corrupt its world while saving. Delete old backups or exports first if you can."
          />
        </form>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="noteOpen = false" />
          <UButton
            :label="disk?.level === 'urgent' ? 'Back up anyway' : 'Back up'"
            :color="disk?.level === 'urgent' ? 'error' : 'primary'"
            icon="i-lucide-archive"
            @click="backupNow"
          />
        </div>
      </template>
    </UModal>

    <UModal
      :open="restoring !== null"
      title="Restore this backup?"
      @update:open="(v) => !v && (restoring = null)"
    >
      <template #body>
        <div v-if="restoring" class="space-y-3 text-sm">
          <p>
            {{ server?.displayName }} goes back to how it was on
            <strong>{{ when(restoring.createdAt) }}</strong
            >.
          </p>
          <ul class="list-disc space-y-1 pl-5 text-muted">
            <li>The server stops first, so anyone playing is disconnected.</li>
            <li>The current files are kept as a safety copy, so you can undo this.</li>
            <li>It starts again afterwards if it was running.</li>
          </ul>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="restoring = null" />
          <UButton label="Restore" icon="i-lucide-history" color="warning" @click="restore" />
        </div>
      </template>
    </UModal>

    <UModal
      :open="deleting !== null"
      title="Delete this backup?"
      :description="
        deleting
          ? `${when(deleting.createdAt)}, ${size(deleting.bytes)}. This can't be undone.`
          : ''
      "
      @update:open="(v) => !v && (deleting = null)"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="deleting = null" />
          <UButton label="Delete" color="error" icon="i-lucide-trash-2" @click="remove" />
        </div>
      </template>
    </UModal>
  </div>
</template>
