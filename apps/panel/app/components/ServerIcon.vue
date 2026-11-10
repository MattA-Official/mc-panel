<script setup lang="ts">
/**
 * The server's icon in the multiplayer list. A picture is cropped to a square and scaled to
 * 64×64 here in the browser, then sent as a PNG; the server checks it and keeps only the
 * image itself.
 */
const props = defineProps<{ motd: string; maxPlayers?: number }>()
const { server, refresh } = useServerContext()
const toast = useToast()

const SIZE = 64
const MAX_UPLOAD = 10 * 1024 * 1024
const VIEW = 256

const picker = ref<HTMLInputElement>()
const open = ref(false)
const image = shallowRef<ImageBitmap | null>(null)
/** The crop: how far in (1 is the largest square that fits) and its centre, in image pixels. */
const zoom = ref(1)
const centre = reactive({ x: 0, y: 0 })
const view = ref<HTMLCanvasElement>()
const result = ref<string | null>(null)
const saving = ref(false)
const removing = ref(false)

async function choose(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    toast.add({ title: 'Pick a PNG, JPEG or WebP picture', color: 'error' })
    return
  }
  if (file.size > MAX_UPLOAD) {
    toast.add({ title: 'That picture is over 10 MB', color: 'error' })
    return
  }
  try {
    image.value = await createImageBitmap(file)
  } catch {
    toast.add({ title: "Couldn't read that picture", color: 'error' })
    return
  }
  zoom.value = 1
  centre.x = image.value.width / 2
  centre.y = image.value.height / 2
  open.value = true
}

/** The square of the picture that's kept, clamped inside it. */
const crop = computed(() => {
  const img = image.value
  if (!img) return { x: 0, y: 0, side: 1 }
  const side = Math.min(img.width, img.height) / zoom.value
  const x = Math.min(Math.max(centre.x - side / 2, 0), img.width - side)
  const y = Math.min(Math.max(centre.y - side / 2, 0), img.height - side)
  return { x, y, side }
})

function draw(canvas: HTMLCanvasElement, size: number) {
  const ctx = canvas.getContext('2d')
  const img = image.value
  if (!ctx || !img) return
  canvas.width = size
  canvas.height = size
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, size, size)
  const { x, y, side } = crop.value
  ctx.drawImage(img, x, y, side, side, 0, 0, size, size)
}

const output = document.createElement('canvas')
watchEffect(() => {
  if (!open.value || !image.value) return
  void crop.value
  if (view.value) draw(view.value, VIEW)
  draw(output, SIZE)
  result.value = output.toDataURL('image/png')
})

// Dragging the picture moves the crop.
let drag: { x: number; y: number; cx: number; cy: number } | null = null
function onPointerDown(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  const { x, y, side } = crop.value
  drag = { x: e.clientX, y: e.clientY, cx: x + side / 2, cy: y + side / 2 }
}
function onPointerMove(e: PointerEvent) {
  if (!drag) return
  const scale = crop.value.side / (e.currentTarget as HTMLElement).clientWidth
  centre.x = drag.cx - (e.clientX - drag.x) * scale
  centre.y = drag.cy - (e.clientY - drag.y) * scale
}
function onPointerUp() {
  if (!drag) return
  // Keep the centre where the clamped crop actually is.
  centre.x = crop.value.x + crop.value.side / 2
  centre.y = crop.value.y + crop.value.side / 2
  drag = null
}

async function save() {
  saving.value = true
  try {
    const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error("Couldn't make the icon.")
    await $fetch(`/api/servers/${server.value!.name}/icon`, {
      method: 'PUT',
      body: blob,
      headers: { 'content-type': 'image/png' },
    })
    await refresh()
    open.value = false
    toast.add({
      title: 'Icon saved',
      description: 'It shows in the multiplayer list after the next restart.',
      color: 'success',
    })
  } catch (err) {
    toast.add({ title: "Couldn't save the icon", description: errorMessage(err), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function remove() {
  removing.value = true
  try {
    await $fetch(`/api/servers/${server.value!.name}/icon`, { method: 'DELETE' })
    await refresh()
    toast.add({
      title: 'Icon removed',
      description: 'The default shows after the next restart.',
      color: 'success',
    })
  } catch (err) {
    toast.add({ title: "Couldn't remove the icon", description: errorMessage(err), color: 'error' })
  } finally {
    removing.value = false
  }
}

watch(open, (o) => {
  if (!o) {
    image.value?.close()
    image.value = null
    result.value = null
  }
})
const name = computed(() => server.value?.displayName ?? server.value?.name ?? '')
</script>

<template>
  <div class="flex flex-wrap items-center gap-4" data-e2e="server-icon">
    <div class="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md bg-[#2b2b2b]">
      <img
        v-if="server?.icon"
        :src="server.icon"
        alt="Server icon"
        class="size-16 [image-rendering:pixelated]"
      />
      <UIcon v-else name="i-lucide-box" class="size-8 text-[#9a9a9a]" />
    </div>
    <div class="min-w-0 flex-1 text-sm">
      <p class="font-medium">Server icon</p>
      <p class="text-muted">
        Shown next to the server in the multiplayer list, after the next restart.
      </p>
    </div>
    <div class="flex gap-2">
      <UButton
        :label="server?.icon ? 'Change' : 'Upload'"
        icon="i-lucide-upload"
        color="neutral"
        variant="outline"
        @click="picker?.click()"
      />
      <UButton
        v-if="server?.icon"
        label="Remove"
        color="neutral"
        variant="ghost"
        :loading="removing"
        @click="remove"
      />
    </div>
    <input
      ref="picker"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      class="hidden"
      data-e2e="server-icon-file"
      @change="choose"
    />

    <UModal v-model:open="open" title="Crop the icon" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <div class="space-y-4">
          <div class="flex flex-wrap items-start gap-6">
            <div class="space-y-2">
              <canvas
                ref="view"
                class="size-64 max-w-full cursor-move touch-none rounded-md bg-[#2b2b2b]"
                aria-label="Drag to move the crop"
                @pointerdown="onPointerDown"
                @pointermove="onPointerMove"
                @pointerup="onPointerUp"
                @pointercancel="onPointerUp"
              />
              <label class="flex items-center gap-2 text-sm">
                <UIcon name="i-lucide-zoom-in" class="size-4 text-muted" />
                <span class="sr-only">Zoom</span>
                <USlider v-model="zoom" :min="1" :max="4" :step="0.01" class="w-52" />
              </label>
            </div>
            <div class="space-y-2 text-sm">
              <p class="font-medium">64 × 64</p>
              <img
                v-if="result"
                :src="result"
                alt="The icon as it will be saved"
                class="size-16 rounded-sm [image-rendering:pixelated]"
                data-e2e="server-icon-result"
              />
              <p class="max-w-48 text-muted">
                Drag to move, and zoom to crop closer. Minecraft shows it at this size.
              </p>
            </div>
          </div>
          <MotdPreview :motd="props.motd" :name="name" :max-players="maxPlayers" :icon="result" />
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
          <UButton label="Save icon" :loading="saving" :disabled="!result" @click="save" />
        </div>
      </template>
    </UModal>
  </div>
</template>
