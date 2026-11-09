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
const ttl = ref<'1h' | '24h' | '7d'>('24h')
const ttls = [
  { label: '1 hour', value: '1h' },
  { label: '24 hours', value: '24h' },
  { label: '7 days', value: '7d' },
]
const link = ref<string | null>(null)
async function makeLink() {
  if (!sharing.value) return
  try {
    const res = await $fetch<{ url: string }>(
      `${base.value}/${sharing.value.id}/shares` as string,
      { method: 'POST', body: { ttl: ttl.value } },
    )
    link.value = res.url
    refresh()
  } catch (err) {
    toast.add({ title: "Couldn't make a link", description: errorMessage(err), color: 'error' })
  }
}
async function copy() {
  if (!link.value) return
  try {
    await navigator.clipboard.writeText(link.value)
    toast.add({ title: 'Link copied', color: 'success' })
  } catch {
    toast.add({ title: 'Select the link and copy it', color: 'neutral' })
  }
}
function closeShare() {
  sharing.value = null
  link.value = null
}

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
    await $fetch(`${base.value}/${e.id}` as string, { method: 'DELETE' })
    toast.add({ title: 'Export deleted', color: 'success' })
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
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
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
      <li v-for="e in exports" :key="e.id" class="py-3 first:pt-0 last:pb-0">
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
      </li>
    </ul>

    <UModal
      :open="sharing !== null"
      title="Share this world"
      @update:open="(v) => !v && closeShare()"
    >
      <template #body>
        <div v-if="!link" class="space-y-4">
          <p class="text-sm text-muted">
            Anyone with the link can download the world, without an account, until it ends or you
            turn it off.
          </p>
          <UFormField label="Link works for">
            <URadioGroup v-model="ttl" :items="ttls" orientation="horizontal" />
          </UFormField>
        </div>
        <div v-else class="space-y-3">
          <p class="text-sm">Here's the link. It's only shown once, so copy it now.</p>
          <div class="flex gap-2">
            <UInput :model-value="link" readonly class="flex-1 font-mono" aria-label="Share link" />
            <UButton label="Copy" icon="i-lucide-copy" @click="copy" />
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <template v-if="!link">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="closeShare" />
            <UButton label="Make link" icon="i-lucide-link" @click="makeLink" />
          </template>
          <UButton v-else label="Done" @click="closeShare" />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
