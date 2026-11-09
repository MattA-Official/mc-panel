<script setup lang="ts">
const emit = defineEmits<{ saved: [] }>()
const { server, refresh } = useServerContext()
const toast = useToast()

const { data: defaults } = await useFetch<{ budget: { freeMb: number } }>('/api/servers/defaults')
const memoryMb = ref(server.value?.memoryMb ?? 2048)
const port = ref(server.value?.port ?? 25565)
watch(server, (s) => {
  if (!s) return
  memoryMb.value = s.memoryMb
  port.value = s.port
})
const dirty = computed(
  () =>
    !!server.value &&
    (memoryMb.value !== server.value.memoryMb || port.value !== server.value.port),
)
// Up to what's free plus this server's own share, and always the current value (even on a
// machine that is over budget, say after moving to a smaller one).
const maxMemory = computed(() => {
  const current = server.value?.memoryMb ?? 0
  const room = Math.floor((current + (defaults.value?.budget.freeMb ?? 0)) / 512) * 512
  return Math.max(current, room, 1024)
})

const saving = ref(false)
async function save() {
  if (!server.value) return
  saving.value = true
  try {
    await $fetch(`/api/servers/${server.value.name}/resources` as string, {
      method: 'PATCH',
      body: { memoryMb: memoryMb.value, port: port.value },
    })
    await refresh()
    emit('saved')
    toast.add({ title: 'Resources saved', color: 'success' })
  } catch (err) {
    toast.add({ title: "Couldn't save", description: errorMessage(err), color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="rounded-lg border border-default p-5">
    <h2 class="font-display text-lg tracking-wide uppercase">Resources</h2>
    <div class="mt-4 grid gap-6 sm:grid-cols-[1fr_auto]">
      <UFormField
        label="Memory"
        :description="`${(memoryMb / 1024).toFixed(1)} GB of heap, plus about 1 GB for Java itself.`"
      >
        <USlider v-model="memoryMb" :min="1024" :max="maxMemory" :step="512" class="mt-2" />
      </UFormField>
      <UFormField label="Port">
        <UInputNumber
          v-model="port"
          :min="1024"
          :max="65535"
          :format-options="{ useGrouping: false }"
          class="w-36"
        />
      </UFormField>
    </div>
    <div class="mt-5 flex justify-end">
      <UButton label="Save" :disabled="!dirty" :loading="saving" @click="save" />
    </div>
  </section>
</template>
