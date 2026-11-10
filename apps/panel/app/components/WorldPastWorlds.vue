<script setup lang="ts">
/** Old worlds kept at a reset: download, share, rename, delete, or start a server from one. */
interface ShareLink {
  id: number
  createdAt: string
  expiresAt: string
  downloads: number
}
interface PastWorld {
  id: number
  name: string
  bytes: number
  createdAt: string
  shares: ShareLink[]
}

const props = defineProps<{ server: string }>()
const toast = useToast()
const exportsBase = computed(() => `/api/servers/${props.server}/exports`)

const { data: worlds, refresh } = await useFetch<PastWorld[]>(
  () => `/api/servers/${props.server}/past-worlds`,
  { default: () => [] },
)
defineExpose({ refresh })

const sharing = ref<PastWorld | null>(null)

async function revoke(w: PastWorld, s: ShareLink) {
  try {
    await $fetch(`${exportsBase.value}/${w.id}/shares/${s.id}` as string, { method: 'DELETE' })
    toast.add({ title: 'Link turned off', color: 'success' })
    refresh()
  } catch (err) {
    toast.add({ title: "Couldn't turn it off", description: errorMessage(err), color: 'error' })
  }
}

// Renaming
const renaming = ref<PastWorld | null>(null)
const newName = ref('')
function startRename(w: PastWorld) {
  newName.value = w.name
  renaming.value = w
}
async function rename() {
  if (!renaming.value || !newName.value.trim()) return
  try {
    await $fetch(`/api/servers/${props.server}/past-worlds/${renaming.value.id}` as string, {
      method: 'PATCH',
      body: { name: newName.value.trim() },
    })
    renaming.value = null
    refresh()
  } catch (err) {
    toast.add({ title: "Couldn't rename it", description: errorMessage(err), color: 'error' })
  }
}

// Deleting
const deleting = ref<PastWorld | null>(null)
async function remove() {
  if (!deleting.value) return
  try {
    await $fetch(`${exportsBase.value}/${deleting.value.id}` as string, { method: 'DELETE' })
    toast.add({ title: `Deleted ${deleting.value.name}`, color: 'success' })
    deleting.value = null
    refresh()
  } catch (err) {
    toast.add({ title: "Couldn't delete it", description: errorMessage(err), color: 'error' })
  }
}

function menu(w: PastWorld) {
  return [
    [
      {
        label: 'Start a server from it',
        icon: 'i-lucide-server',
        to: `/servers/import?pastWorld=${w.id}`,
      },
      { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => startRename(w) },
    ],
    [
      {
        label: 'Delete',
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        onSelect: () => (deleting.value = w),
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
      <h2 class="font-semibold">Past worlds</h2>
      <p class="text-sm text-muted">
        Old worlds kept when the world was reset. Each opens as a singleplayer world, and is kept
        until you delete it.
      </p>
    </template>

    <p v-if="worlds.length === 0" class="text-sm text-muted">
      None yet. When you reset the world, you can keep the old one here.
    </p>
    <ul v-else class="divide-y divide-default">
      <li v-for="w in worlds" :key="w.id" class="py-3 first:pt-0 last:pb-0" data-e2e="past-world">
        <div class="flex flex-wrap items-center gap-2">
          <UIcon name="i-lucide-archive" class="size-4 text-muted" />
          <span class="font-medium">{{ w.name }}</span>
          <span class="text-sm text-muted">{{ size(w.bytes) }} · kept {{ when(w.createdAt) }}</span>
          <div class="ml-auto flex gap-1">
            <UButton
              label="Download"
              icon="i-lucide-download"
              size="sm"
              color="neutral"
              variant="ghost"
              :href="`${exportsBase}/${w.id}/download`"
              download
            />
            <UButton
              label="Share"
              icon="i-lucide-link"
              size="sm"
              color="neutral"
              variant="ghost"
              @click="sharing = w"
            />
            <UDropdownMenu :items="menu(w)">
              <UButton
                icon="i-lucide-ellipsis"
                size="sm"
                color="neutral"
                variant="ghost"
                :aria-label="`More for ${w.name}`"
              />
            </UDropdownMenu>
          </div>
        </div>
        <ul v-if="w.shares.length" class="mt-2 space-y-1">
          <li
            v-for="s in w.shares"
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
              @click="revoke(w, s)"
            />
          </li>
        </ul>
      </li>
    </ul>

    <WorldShareModal
      :base="exportsBase"
      :export-id="sharing?.id ?? null"
      :title="sharing ? `Share ${sharing.name}` : undefined"
      @close="sharing = null"
      @shared="refresh()"
    />

    <UModal
      :open="renaming !== null"
      title="Rename past world"
      @update:open="(v) => !v && (renaming = null)"
    >
      <template #body>
        <UFormField label="Name">
          <UInput v-model="newName" class="w-full" :maxlength="60" @keydown.enter="rename" />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="renaming = null" />
          <UButton label="Rename" :disabled="!newName.trim()" @click="rename" />
        </div>
      </template>
    </UModal>

    <UModal
      :open="deleting !== null"
      :title="`Delete ${deleting?.name}?`"
      @update:open="(v) => !v && (deleting = null)"
    >
      <template #body>
        <p class="text-sm">
          The world is deleted for good, and its share links stop working. Backups aren't touched.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="deleting = null" />
          <UButton label="Delete" color="error" icon="i-lucide-trash-2" @click="remove" />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
