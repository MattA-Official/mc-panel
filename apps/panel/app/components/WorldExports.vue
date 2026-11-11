<script setup lang="ts">
interface ShareLink {
  id: number
  createdAt: string
  expiresAt: string
  downloads: number
}
interface WorldExport {
  id: number
  bytes: number
  createdAt: string
  expiresAt: string
  shares: ShareLink[]
}

const props = defineProps<{ server: string; disabled?: boolean }>()
const emit = defineEmits<{ busy: [boolean] }>()
const toast = useToast()
const withElevation = useElevation()
const base = computed(() => `/api/servers/${props.server}/exports`)

const { data: exports, refresh } = await useFetch<WorldExport[]>(() => base.value, {
  default: () => [],
})

const jobId = ref<number | null>(null)
const finished = ref<JobEvent | null>(null)
watch([jobId, finished], () => emit('busy', !!jobId.value && !finished.value))

async function exportNow() {
  try {
    const res = await $fetch<{ jobId: number }>(base.value, { method: 'POST' })
    finished.value = null
    jobId.value = res.jobId
  } catch (err) {
    toast.add({
      title: "Couldn't start the export",
      description: errorMessage(err),
      color: 'error',
    })
  }
}
function onFinished(e: JobEvent) {
  finished.value = e
  refresh()
}

// Sharing
const sharing = ref<WorldExport | null>(null)

async function revoke(e: WorldExport, s: ShareLink) {
  try {
    await $fetch(`${base.value}/${e.id}/shares/${s.id}` as string, { method: 'DELETE' })
    toast.add({ title: 'Link turned off', color: 'success' })
    refresh()
  } catch (err) {
    toast.add({ title: "Couldn't turn it off", description: errorMessage(err), color: 'error' })
  }
}
async function remove(e: WorldExport) {
  try {
    await withElevation(() => $fetch(`${base.value}/${e.id}` as string, { method: 'DELETE' }))
    toast.add({ title: 'Export deleted', color: 'success' })
    refresh()
  } catch (err) {
    toast.add({ title: "Couldn't delete it", description: errorMessage(err), color: 'error' })
  }
}

/** One export's actions, for its ⋯ button and right-click menu (#106). */
function rowMenu(e: WorldExport) {
  return [
    [
      {
        label: 'Download',
        icon: 'i-lucide-download',
        href: `${base.value}/${e.id}/download`,
        download: true,
      },
      { label: 'Share link…', icon: 'i-lucide-link', onSelect: () => (sharing.value = e) },
      ...(e.shares.length
        ? [
            {
              label: e.shares.length === 1 ? 'Turn off the link' : 'Turn off all links',
              icon: 'i-lucide-link-2-off',
              onSelect: () => void Promise.all(e.shares.map((s) => revoke(e, s))),
            },
          ]
        : []),
    ],
    [
      {
        label: 'Delete',
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        onSelect: () => void remove(e),
      },
    ],
  ]
}

function size(n: number) {
  if (n < 1024 ** 2) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}
const when = (iso: string) => formatDateTime(iso)
function until(iso: string) {
  const ms = new Date(iso).getTime() - Date.now()
  const h = Math.round(ms / 3_600_000)
  if (h < 1) return 'in under an hour'
  if (h === 1) return 'in 1 hour'
  if (h < 48) return `in ${h} hours`
  return `in ${Math.round(h / 24)} days`
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="font-semibold">Export world</h2>
          <p class="text-sm text-muted">
            A zip that opens as a singleplayer world. Exports are deleted after 7 days.
          </p>
        </div>
        <UButton
          label="Export now"
          icon="i-lucide-package"
          color="neutral"
          variant="outline"
          :disabled="disabled || (!!jobId && !finished)"
          @click="exportNow"
        />
      </div>
    </template>

    <div v-if="jobId" class="mb-5">
      <JobProgress :key="jobId" :job-id="jobId" :steps="EXPORT_STEPS" @finished="onFinished" />
    </div>

    <p v-if="exports.length === 0" class="text-sm text-muted">No exports yet.</p>
    <ul v-else class="divide-y divide-default">
      <ActionTarget
        v-for="e in exports"
        :key="e.id"
        as="li"
        :items="rowMenu(e)"
        :label="`Export ${when(e.createdAt)}`"
        class="py-3 first:pt-0 last:pb-0"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium">{{ when(e.createdAt) }}</span>
          <span class="text-sm text-muted"
            >{{ size(e.bytes) }} · deleted {{ until(e.expiresAt) }}</span
          >
          <div class="ml-auto flex gap-1">
            <UButton
              label="Download"
              icon="i-lucide-download"
              size="sm"
              color="neutral"
              variant="ghost"
              :href="`${base}/${e.id}/download`"
              download
            />
            <UButton
              label="Share"
              icon="i-lucide-link"
              size="sm"
              color="neutral"
              variant="ghost"
              @click="sharing = e"
            />
            <UButton
              icon="i-lucide-trash-2"
              size="sm"
              color="error"
              variant="ghost"
              :aria-label="`Delete export from ${when(e.createdAt)}`"
              @click="remove(e)"
            />
          </div>
        </div>
        <ul v-if="e.shares.length" class="mt-2 space-y-1">
          <li
            v-for="s in e.shares"
            :key="s.id"
            class="flex flex-wrap items-center gap-2 rounded-md bg-elevated/50 px-3 py-1.5 text-sm"
          >
            <UIcon name="i-lucide-link" class="size-4 text-primary" />
            <span>Share link, ends {{ until(s.expiresAt) }}</span>
            <span class="text-muted"
              >· {{ s.downloads }} download{{ s.downloads === 1 ? '' : 's' }}</span
            >
            <UButton
              label="Turn off"
              size="xs"
              color="error"
              variant="ghost"
              class="ml-auto"
              @click="revoke(e, s)"
            />
          </li>
        </ul>
      </ActionTarget>
    </ul>

    <WorldShareModal
      :base="base"
      :export-id="sharing?.id ?? null"
      @close="sharing = null"
      @shared="refresh()"
    />
  </UCard>
</template>
