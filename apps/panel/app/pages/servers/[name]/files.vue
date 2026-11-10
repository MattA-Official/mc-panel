<script setup lang="ts">
interface Entry {
  name: string
  type: 'file' | 'dir' | 'link' | 'other'
  size: number
  modified: number
}

const { server } = useServerContext()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const base = computed(() => `/api/servers/${server.value?.name}/files`)
const path = computed(() => normalise(String(route.query.path ?? '/')))
function normalise(p: string) {
  const parts: string[] = []
  for (const s of p.split('/')) {
    if (s === '..') parts.pop()
    else if (s && s !== '.') parts.push(s)
  }
  return '/' + parts.join('/')
}
const join = (dir: string, name: string) => normalise(`${dir}/${name}`)
const go = (p: string) => router.push({ query: { path: p === '/' ? undefined : p } })

const {
  data: entries,
  refresh,
  error,
} = await useFetch<Entry[]>(() => `${base.value}/list`, {
  query: { path },
  default: () => [],
})

const crumbs = computed(() => {
  const parts = path.value.split('/').filter(Boolean)
  return [
    { label: server.value?.name ?? 'server', to: '/' },
    ...parts.map((p, i) => ({ label: p, to: '/' + parts.slice(0, i + 1).join('/') })),
  ]
})

function size(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}
const when = (ms: number) => formatDateTime(ms)
const icon = (e: Entry) =>
  e.type === 'dir'
    ? 'i-lucide-folder'
    : e.type === 'link'
      ? 'i-lucide-link'
      : /\.(jar|zip|gz|zst|mca|dat)$/.test(e.name)
        ? 'i-lucide-file-archive'
        : 'i-lucide-file-text'

async function call(method: 'POST' | 'DELETE', action: string, body: object, done: string) {
  try {
    await $fetch(`${base.value}/${action}` as string, { method, body })
    toast.add({ title: done, color: 'success' })
    await refresh()
    return true
  } catch (err) {
    toast.add({ title: "That didn't work", description: errorMessage(err), color: 'error' })
    return false
  }
}

// Editing
const editing = ref<{ path: string; original: string; content: string } | null>(null)
const editorOpen = computed({
  get: () => !!editing.value,
  set: (v) => {
    if (!v) closeEditor()
  },
})
const loadingFile = ref<string | null>(null)
async function open(e: Entry) {
  if (e.type === 'dir') return go(join(path.value, e.name))
  if (e.type !== 'file') return
  const p = join(path.value, e.name)
  loadingFile.value = p
  try {
    const { content } = await $fetch<{ content: string }>(`${base.value}/read` as string, {
      query: { path: p },
    })
    editing.value = { path: p, original: content, content }
  } catch (err) {
    toast.add({ title: "Can't open that here", description: errorMessage(err), color: 'warning' })
  } finally {
    loadingFile.value = null
  }
}
const dirty = computed(() => !!editing.value && editing.value.content !== editing.value.original)
function closeEditor() {
  if (dirty.value && !confirm('Discard your unsaved changes?')) return
  editing.value = null
}
const saving = ref(false)
async function save() {
  if (!editing.value) return
  saving.value = true
  try {
    await $fetch(`${base.value}/write` as string, {
      method: 'PUT',
      body: { path: editing.value.path, content: editing.value.content },
    })
    editing.value.original = editing.value.content
    toast.add({ title: 'Saved', color: 'success' })
    await refresh()
  } catch (err) {
    toast.add({ title: "Couldn't save", description: errorMessage(err), color: 'error' })
  } finally {
    saving.value = false
  }
}

// Rename, new folder, delete
const renaming = ref<{ from: string; to: string } | null>(null)
async function doRename() {
  if (!renaming.value) return
  const ok = await call(
    'POST',
    'rename',
    { from: renaming.value.from, to: join(path.value, renaming.value.to) },
    'Renamed',
  )
  if (ok) renaming.value = null
}
const newFolder = ref<string | null>(null)
async function doMkdir() {
  if (!newFolder.value) return
  if (await call('POST', 'mkdir', { path: join(path.value, newFolder.value) }, 'Folder created')) {
    newFolder.value = null
  }
}
const deleting = ref<Entry | null>(null)
async function doDelete() {
  if (!deleting.value) return
  if (await call('DELETE', '', { path: join(path.value, deleting.value.name) }, 'Deleted')) {
    deleting.value = null
  }
}

function rowMenu(e: Entry) {
  const p = join(path.value, e.name)
  return [
    [
      ...(e.type === 'file'
        ? [
            { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => open(e) },
            {
              label: 'Download',
              icon: 'i-lucide-download',
              href: `${base.value}/download?path=${encodeURIComponent(p)}`,
              download: e.name,
            },
          ]
        : []),
      {
        label: 'Rename',
        icon: 'i-lucide-text-cursor-input',
        onSelect: () => (renaming.value = { from: p, to: e.name }),
      },
    ],
    [
      {
        label: 'Delete',
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        onSelect: () => (deleting.value = e),
      },
    ],
  ]
}

// Uploads: XHR for progress, one file at a time.
const uploads = ref<{ name: string; progress: number }[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
function upload(file: File) {
  const item = reactive({ name: file.name, progress: 0 })
  uploads.value.push(item)
  return new Promise<void>((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `${base.value}/upload?path=${encodeURIComponent(join(path.value, file.name))}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) item.progress = Math.round((e.loaded / e.total) * 100)
    }
    xhr.onloadend = () => {
      uploads.value = uploads.value.filter((u) => u !== item)
      if (xhr.status >= 200 && xhr.status < 300)
        toast.add({ title: `Uploaded ${file.name}`, color: 'success' })
      else {
        let msg = `Upload failed (${xhr.status || 'network error'})`
        try {
          msg = JSON.parse(xhr.responseText).statusMessage ?? msg
        } catch {}
        toast.add({ title: `Couldn't upload ${file.name}`, description: msg, color: 'error' })
      }
      resolve()
    }
    xhr.send(file)
  })
}
async function uploadAll(files: FileList | File[] | null | undefined) {
  for (const f of Array.from(files ?? [])) await upload(f)
  await refresh()
}
const dragging = ref(false)
function onDrop(e: DragEvent) {
  dragging.value = false
  uploadAll(e.dataTransfer?.files)
}
</script>

<template>
  <div
    class="relative mx-auto w-full max-w-5xl"
    @dragover.prevent="dragging = true"
    @dragleave.self="dragging = false"
    @drop.prevent="onDrop"
  >
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <nav
        aria-label="Folder"
        class="flex min-w-0 flex-1 flex-wrap items-center gap-1 font-mono text-sm"
      >
        <template v-for="(c, i) in crumbs" :key="c.to">
          <span v-if="i > 0" class="text-dimmed">/</span>
          <button
            type="button"
            class="rounded px-1 hover:bg-elevated"
            :class="i === crumbs.length - 1 ? 'text-highlighted' : 'text-muted'"
            @click="go(c.to)"
          >
            {{ c.label }}
          </button>
        </template>
      </nav>
      <UButton
        label="New folder"
        icon="i-lucide-folder-plus"
        color="neutral"
        variant="outline"
        @click="newFolder = ''"
      />
      <UButton label="Upload" icon="i-lucide-upload" @click="fileInput?.click()" />
      <input
        ref="fileInput"
        type="file"
        multiple
        class="hidden"
        @change="uploadAll(($event.target as HTMLInputElement).files)"
      />
    </div>

    <div v-for="u in uploads" :key="u.name" class="mb-2 flex items-center gap-3 text-sm">
      <span class="w-48 truncate">{{ u.name }}</span>
      <UProgress :model-value="u.progress" class="flex-1" />
    </div>

    <UAlert v-if="error" color="error" variant="subtle" :title="errorMessage(error)" />
    <div v-else class="overflow-hidden rounded-lg border border-default">
      <table class="w-full text-sm">
        <thead class="bg-elevated/50 text-left text-xs text-muted">
          <tr>
            <th class="px-3 py-2 font-medium">Name</th>
            <th class="hidden px-3 py-2 text-right font-medium sm:table-cell">Size</th>
            <th class="hidden px-3 py-2 font-medium md:table-cell">Modified</th>
            <th class="w-10"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <tr v-if="path !== '/'" class="hover:bg-elevated/40">
            <td colspan="4" class="px-3 py-1.5">
              <button
                type="button"
                class="flex items-center gap-2 text-muted"
                @click="go(join(path, '..'))"
              >
                <UIcon name="i-lucide-corner-left-up" class="size-4" /> Up
              </button>
            </td>
          </tr>
          <tr v-for="e in entries" :key="e.name" class="group hover:bg-elevated/40">
            <td class="px-3 py-1.5">
              <button
                type="button"
                class="flex max-w-full items-center gap-2 text-left"
                :class="e.type === 'link' || e.type === 'other' ? 'cursor-default text-muted' : ''"
                @click="open(e)"
              >
                <UIcon
                  :name="loadingFile === join(path, e.name) ? 'i-lucide-loader-circle' : icon(e)"
                  class="size-4 shrink-0"
                  :class="[
                    e.type === 'dir' ? 'text-primary' : 'text-muted',
                    loadingFile === join(path, e.name) ? 'animate-spin' : '',
                  ]"
                />
                <span class="truncate">{{ e.name }}</span>
              </button>
            </td>
            <td class="hidden px-3 py-1.5 text-right text-muted tabular-nums sm:table-cell">
              {{ e.type === 'file' ? size(e.size) : '' }}
            </td>
            <td class="hidden px-3 py-1.5 text-muted md:table-cell">{{ when(e.modified) }}</td>
            <td class="px-1">
              <UDropdownMenu :items="rowMenu(e)">
                <UButton
                  icon="i-lucide-ellipsis"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  :aria-label="`Actions for ${e.name}`"
                />
              </UDropdownMenu>
            </td>
          </tr>
          <tr v-if="entries.length === 0">
            <td colspan="4" class="px-3 py-6 text-center text-muted">This folder is empty.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="mt-2 text-xs text-muted">Drop files anywhere here to upload them to this folder.</p>

    <div
      v-if="dragging"
      class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-default/80 text-primary"
    >
      Drop to upload to {{ path }}
    </div>

    <USlideover
      v-model:open="editorOpen"
      :title="editing?.path"
      side="right"
      :ui="{ content: 'w-full sm:max-w-3xl' }"
    >
      <template #body>
        <UAlert
          v-if="editing?.path === '/server.properties'"
          class="mb-3"
          color="warning"
          variant="subtle"
          icon="i-lucide-info"
          description="The Settings tab is the safer way to change these. Flytower manages the RCON lines."
        />
        <textarea
          v-if="editing"
          v-model="editing.content"
          spellcheck="false"
          aria-label="File contents"
          class="h-[calc(100dvh-12rem)] w-full resize-none rounded-md border border-default bg-[#0b0e14] p-3 font-mono text-[13px] leading-relaxed text-default outline-none focus:border-primary"
          @keydown.meta.s.prevent="save"
          @keydown.ctrl.s.prevent="save"
        />
      </template>
      <template #footer>
        <div class="flex w-full items-center justify-between">
          <span class="text-xs text-muted">{{ dirty ? 'Unsaved changes' : 'Saved' }}</span>
          <div class="flex gap-2">
            <UButton label="Close" color="neutral" variant="ghost" @click="closeEditor" />
            <UButton label="Save" :disabled="!dirty" :loading="saving" @click="save" />
          </div>
        </div>
      </template>
    </USlideover>

    <UModal :open="renaming !== null" title="Rename" @update:open="(v) => !v && (renaming = null)">
      <template #body>
        <form v-if="renaming" @submit.prevent="doRename">
          <UInput v-model="renaming.to" class="w-full font-mono" autofocus aria-label="New name" />
        </form>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="renaming = null" />
          <UButton label="Rename" :disabled="!renaming?.to" @click="doRename" />
        </div>
      </template>
    </UModal>

    <UModal
      :open="newFolder !== null"
      title="New folder"
      @update:open="(v) => !v && (newFolder = null)"
    >
      <template #body>
        <form @submit.prevent="doMkdir">
          <UInput
            :model-value="newFolder ?? ''"
            class="w-full font-mono"
            autofocus
            aria-label="Folder name"
            placeholder="mods"
            @update:model-value="newFolder = String($event)"
          />
        </form>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="newFolder = null" />
          <UButton label="Create" :disabled="!newFolder" @click="doMkdir" />
        </div>
      </template>
    </UModal>

    <UModal
      :open="deleting !== null"
      :title="`Delete ${deleting?.name}?`"
      :description="
        deleting?.type === 'dir'
          ? 'The folder and everything in it will be deleted. This can\'t be undone.'
          : 'This can\'t be undone.'
      "
      @update:open="(v) => !v && (deleting = null)"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="deleting = null" />
          <UButton label="Delete" color="error" icon="i-lucide-trash-2" @click="doDelete" />
        </div>
      </template>
    </UModal>
  </div>
</template>
