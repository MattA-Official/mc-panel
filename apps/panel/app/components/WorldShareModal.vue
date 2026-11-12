<script setup lang="ts">
/** Makes a share link for an export or past world, shown once. */
const props = defineProps<{ base: string; exportId: number | null; title?: string }>()
const emit = defineEmits<{ close: []; shared: [] }>()
const toast = useToast()

const ttl = ref<'1h' | '24h' | '7d'>('24h')
const ttls = [
  { label: '1 hour', value: '1h' },
  { label: '24 hours', value: '24h' },
  { label: '7 days', value: '7d' },
]
const link = ref<string | null>(null)
watch(
  () => props.exportId,
  () => {
    link.value = null
    ttl.value = '24h'
  },
)

async function makeLink() {
  if (props.exportId === null) return
  try {
    const res = await $fetch<{ url: string }>(`${props.base}/${props.exportId}/shares` as string, {
      method: 'POST',
      body: { ttl: ttl.value },
    })
    link.value = res.url
    emit('shared')
  } catch (err) {
    toast.add({ title: "Couldn't make a link", description: errorMessage(err), color: 'error' })
  }
}
const copyText = useCopy()
async function copy() {
  if (link.value) await copyText(link.value, 'Link')
}
</script>

<template>
  <UModal
    :open="exportId !== null"
    :title="title ?? 'Share this world'"
    @update:open="(v) => !v && emit('close')"
  >
    <template #body>
      <div v-if="!link" class="space-y-4">
        <p class="text-sm text-muted">
          Anyone with the link can download the world, without an account, until it ends or you turn
          it off.
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
          <UButton label="Cancel" color="neutral" variant="ghost" @click="emit('close')" />
          <UButton label="Make link" icon="i-lucide-link" @click="makeLink" />
        </template>
        <UButton v-else label="Done" @click="emit('close')" />
      </div>
    </template>
  </UModal>
</template>
