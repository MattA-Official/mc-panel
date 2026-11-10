<script setup lang="ts">
const { server, status } = useServerContext()
const toast = useToast()

// Minecraft reads its settings at start-up, so saving while it runs needs a restart.
const needsRestart = ref(false)
function saved() {
  if (status.value === 'active' || status.value === 'activating') needsRestart.value = true
}
const restarting = ref(false)
async function restart() {
  if (!server.value) return
  restarting.value = true
  try {
    await $fetch(`/api/servers/${server.value.name}/restart` as string, { method: 'POST' })
    needsRestart.value = false
  } catch (err) {
    toast.add({ title: "Couldn't restart", description: errorMessage(err), color: 'error' })
  } finally {
    restarting.value = false
  }
}
</script>

<template>
  <div v-if="server" class="mx-auto w-full max-w-5xl space-y-6">
    <UAlert
      v-if="needsRestart"
      color="warning"
      variant="subtle"
      icon="i-lucide-rotate-cw"
      title="Restart to apply"
      description="The server reads its settings when it starts. Anyone playing will be disconnected briefly."
      :actions="[
        { label: 'Restart now', color: 'warning', loading: restarting, onClick: restart },
        {
          label: 'Later',
          color: 'neutral',
          variant: 'ghost',
          onClick: () => (needsRestart = false),
        },
      ]"
    />
    <ServerProperties @saved="saved" />
    <ServerResources @saved="saved" />
    <ServerAddress />
    <ServerVersion />
    <ServerClone />
    <ServerDangerZone />
  </div>
</template>
