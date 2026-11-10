<script setup lang="ts">
const { server } = useServerContext()
const withElevation = useElevation()
const toast = useToast()

const deleting = ref(false)
const confirmOpen = ref(false)
const typed = ref('')

async function remove() {
  if (!server.value) return
  const name = server.value.name
  deleting.value = true
  try {
    await withElevation(() =>
      $fetch<{ archivedTo: string | null }>(`/api/servers/${name}` as string, {
        method: 'DELETE',
        body: { confirm: typed.value },
      }),
    )
    confirmOpen.value = false
    toast.add({
      title: `${server.value.displayName} deleted`,
      description: 'Its folder was archived first, in case you need it back.',
      color: 'success',
    })
    await navigateTo('/')
  } catch (err) {
    toast.add({
      title: "Couldn't delete the server",
      description: errorMessage(err),
      color: 'error',
    })
  } finally {
    deleting.value = false
  }
}

useOpenFromQuery('delete', () => {
  typed.value = ''
  confirmOpen.value = true
})
</script>

<template>
  <div v-if="server">
    <section class="rounded-lg border border-error/40 p-5">
      <h2 class="text-base font-semibold text-error">Danger zone</h2>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-4">
        <div class="text-sm">
          <p class="font-medium">Delete this server</p>
          <p class="text-muted">
            Stops it, archives its folder, and removes its user, port and firewall rule.
          </p>
        </div>
        <UButton
          label="Delete server"
          color="error"
          variant="soft"
          icon="i-lucide-trash-2"
          @click="((typed = ''), (confirmOpen = true))"
        />
      </div>
    </section>

    <UModal
      v-model:open="confirmOpen"
      :title="`Delete ${server.displayName}?`"
      description="Players are disconnected and the server is removed. Its folder is archived on this machine first."
    >
      <template #body>
        <UFormField :label="`Type ${server.name} to confirm`">
          <UInput v-model="typed" class="w-full font-mono" autocomplete="off" autofocus />
        </UFormField>
        <p class="mt-3 text-xs text-muted">You'll be asked for your passkey.</p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="confirmOpen = false" />
          <UButton
            label="Delete"
            color="error"
            icon="i-lucide-trash-2"
            :loading="deleting"
            :disabled="typed !== server.name"
            @click="remove"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
