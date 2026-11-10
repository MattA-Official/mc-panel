<script setup lang="ts">
/** The Restart and Stop confirm, opened from menus. Same words as the server header's. */
const props = defineProps<{ action: 'stop' | 'restart'; displayName: string }>()
const emit = defineEmits<{ close: [boolean] }>()
const stop = computed(() => props.action === 'stop')
</script>

<template>
  <UModal
    :title="stop ? `Stop ${displayName}?` : `Restart ${displayName}?`"
    description="Anyone playing will be disconnected. The world is saved first."
    :close="false"
    @update:open="(v) => !v && emit('close', false)"
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="emit('close', false)" />
        <UButton
          :label="stop ? 'Stop' : 'Restart'"
          :color="stop ? 'error' : 'primary'"
          @click="emit('close', true)"
        />
      </div>
    </template>
  </UModal>
</template>
