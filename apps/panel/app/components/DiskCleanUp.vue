<script setup lang="ts">
/**
 * One of the fixed ways to free space outside the servers: shrink the systemd journal,
 * clear apt's cache, or remove old Flytower versions. Says how much it should free, asks for
 * a passkey, and is recorded in Activity.
 */
import { CLEAN_UPS, type CleanUp, type SystemDisk } from '~~/shared/disk'

const props = defineProps<{ action: CleanUp; system: SystemDisk }>()
const emit = defineEmits<{ done: [] }>()

const open = defineModel<boolean>('open', { default: false })
const withElevation = useElevation()
const toast = useToast()
const MB = 1024 * 1024

/** Sizes to keep the journal at, smallest first. */
const KEEP = [100, 250, 500, 1000]
const keepMb = ref(250)
const keepItems = KEEP.map((mb) => ({ label: humanMb(mb), value: mb }))

const frees = computed(() => {
  if (props.action === 'journal') return Math.max(0, props.system.journal - keepMb.value * MB)
  if (props.action === 'apt') return props.system.aptCache
  return props.system.oldReleases
})

const what = computed(() => {
  if (props.action === 'journal') {
    return `The systemd journal keeps the machine's logs, Flytower's included, and is using ${humanBytes(props.system.journal)}. Shrinking it deletes the oldest entries until it fits.`
  }
  if (props.action === 'apt') {
    return 'apt keeps every package it has downloaded, in case it needs it again. Clearing the cache deletes them; apt downloads them again if they are ever needed.'
  }
  return "Flytower keeps the version it's running and the one you can go back to. Anything older, with its copy of the database, can go."
})

const busy = ref(false)
async function run() {
  busy.value = true
  try {
    const r = await withElevation(() =>
      $fetch<{ freedBytes: number }>('/api/system/disk/clean', {
        method: 'POST',
        body:
          props.action === 'journal'
            ? { action: 'journal', maxMb: keepMb.value }
            : { action: props.action },
      }),
    )
    toast.add({
      title: r.freedBytes > 0 ? `Freed ${humanBytes(r.freedBytes)}` : 'Nothing to free',
      color: 'success',
    })
    open.value = false
    emit('done')
  } catch (err) {
    toast.add({ title: "Couldn't clean up", description: errorMessage(err), color: 'error' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="CLEAN_UPS[action].label" :dismissible="!busy">
    <template #body>
      <div class="space-y-4 text-sm">
        <p class="text-muted">{{ what }}</p>
        <UFormField v-if="action === 'journal'" label="Keep the journal at">
          <USelect v-model="keepMb" :items="keepItems" class="w-40" />
        </UFormField>
        <p data-e2e="clean-up-frees">
          <template v-if="frees > 0">
            This should free about <strong>{{ humanBytes(frees) }}</strong
            >.
          </template>
          <template v-else>There's nothing to free right now.</template>
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          :disabled="busy"
          @click="open = false"
        />
        <UButton
          :label="CLEAN_UPS[action].label"
          icon="i-lucide-trash-2"
          color="primary"
          :loading="busy"
          :disabled="frees <= 0"
          data-e2e="clean-up-run"
          @click="run"
        />
      </div>
    </template>
  </UModal>
</template>
