<script setup lang="ts">
/** Where this server's backups are copied off the machine. */
interface Target {
  id: number
  name: string
  bucket: string
}
const props = defineProps<{ server: string; target: number | null }>()
const emit = defineEmits<{ saved: [] }>()
const toast = useToast()

const { data: targets } = await useFetch<Target[]>('/api/system/backup-targets', {
  default: () => [],
})
const NONE = 0
const chosen = ref<number>(props.target ?? NONE)
watch(
  () => props.target,
  (t) => (chosen.value = t ?? NONE),
)
const items = computed(() => [
  { label: 'Nowhere: keep backups on this machine only', value: NONE },
  ...(targets.value ?? []).map((t) => ({ label: `${t.name} (${t.bucket})`, value: t.id })),
])

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch(`/api/servers/${props.server}/backups/offsite` as string, {
      method: 'PUT',
      body: { target: chosen.value === NONE ? null : chosen.value },
    })
    toast.add({
      title: chosen.value === NONE ? 'Off-site copies stopped' : 'Copying backups off-site',
      description:
        chosen.value === NONE
          ? 'Copies already made stay where they are.'
          : 'Existing backups are being copied now, and new ones will follow.',
      color: 'success',
    })
    emit('saved')
  } catch (err) {
    toast.add({ title: "Couldn't save", description: errorMessage(err), color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-semibold">Off-site copies</h2>
      <p class="mt-1 text-sm text-muted">
        A copy somewhere else survives this machine being lost. Deleting a backup here deletes its
        copy too.
      </p>
    </template>
    <div v-if="targets?.length" class="flex flex-wrap items-end gap-3">
      <UFormField label="Copy backups to" class="min-w-64 flex-1">
        <USelect v-model="chosen" :items="items" class="w-full" data-e2e="offsite-target" />
      </UFormField>
      <UButton
        label="Save"
        :loading="saving"
        :disabled="chosen === (target ?? NONE)"
        @click="save"
      />
    </div>
    <UAlert
      v-else
      color="neutral"
      variant="subtle"
      icon="i-lucide-cloud"
      title="No storage set up yet"
      description="Add an S3-compatible bucket (Backblaze B2, Cloudflare R2, Wasabi, AWS) on the System page first."
      :actions="[{ label: 'System', to: '/system', color: 'neutral', variant: 'outline' }]"
    />
  </UCard>
</template>
