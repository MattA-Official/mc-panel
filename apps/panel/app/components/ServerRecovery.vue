<script setup lang="ts">
const { server, refresh } = useServerContext()
const toast = useToast()
const saving = ref(false)

async function set(on: boolean) {
  if (!server.value) return
  saving.value = true
  try {
    await $fetch(`/api/servers/${server.value.name}/recovery` as string, {
      method: 'PATCH',
      body: { restartWhenUnresponsive: on },
    })
    await refresh()
  } catch (err) {
    toast.add({ title: "Couldn't save that", description: errorMessage(err), color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section v-if="server" class="rounded-lg border border-default p-5">
    <h2 class="font-display text-lg tracking-wide uppercase">Crashes</h2>
    <p class="mt-1 text-sm text-muted">
      A crashed server is restarted after 15 seconds. After three crashes in ten minutes it is left
      stopped until you start it again, so it doesn't crash forever.
    </p>
    <USwitch
      class="mt-4"
      :model-value="server.restartWhenUnresponsive"
      :loading="saving"
      :disabled="saving"
      label="Restart it when it stops responding"
      description="When the console hasn't answered for five minutes but the server is still running, restart it once. Off, you're only told."
      data-e2e="restart-unresponsive"
      @update:model-value="(v: boolean) => set(v)"
    />
  </section>
</template>
