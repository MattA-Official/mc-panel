<script setup lang="ts">
/** The hostname players use for this server. DNS for it is set up with your provider. */
const { server, refresh } = useServerContext()
const toast = useToast()
const hostname = ref(server.value?.hostname ?? '')
watch(server, (s) => (hostname.value = s?.hostname ?? ''))
const dirty = computed(
  () => !!server.value && hostname.value.trim().toLowerCase() !== (server.value.hostname ?? ''),
)
const saving = ref(false)
async function save() {
  if (!server.value) return
  saving.value = true
  try {
    await $fetch(`/api/servers/${server.value.name}/resources` as string, {
      method: 'PATCH',
      body: { hostname: hostname.value.trim() },
    })
    await refresh()
    toast.add({
      title: hostname.value.trim() ? 'Address saved' : 'Address removed',
      color: 'success',
    })
  } catch (err) {
    toast.add({ title: "Couldn't save", description: errorMessage(err), color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section v-if="server" class="rounded-lg border border-default p-5">
    <h2 class="text-base font-semibold">Address</h2>
    <p class="mt-1 text-sm text-muted">
      A name players connect with instead of an IP address and port. You'll need DNS records for it
      with whoever runs your domain. <HelpLink to="addresses#dns-records" />
    </p>
    <div class="mt-4 flex flex-wrap items-end gap-3">
      <UFormField label="Hostname" class="min-w-64 flex-1">
        <UInput
          v-model="hostname"
          placeholder="survival.example.com"
          class="w-full font-mono"
          autocomplete="off"
          data-e2e="hostname"
        />
      </UFormField>
      <UButton label="Save" :disabled="!dirty" :loading="saving" @click="save" />
    </div>
    <p class="mt-3 text-sm text-muted">Players connect with <CopyAddress :server="server" /></p>
    <DnsRecords
      v-if="server.hostname"
      class="mt-5"
      :server="server.name"
      :hostname="server.hostname"
    />
  </section>
</template>
