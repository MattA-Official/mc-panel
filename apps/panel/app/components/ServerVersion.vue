<script setup lang="ts">
/**
 * Minecraft version and loader. Changes go through a plan, because the world is upgraded,
 * mods need builds for the new version, and Java may change too.
 */
interface Version {
  id: string
  stable: boolean
}

const { server, refresh } = useServerContext()
const toast = useToast()
const change = ref<{ propose: (spec: unknown, o: { title: string }) => Promise<void> }>()

const loader = ref<LoaderId>(server.value?.loader ?? 'fabric')
const minecraft = ref(server.value?.mcVersion ?? '')
const snapshots = ref(false)
watch(server, (s) => {
  if (!s) return
  loader.value = s.loader
  minecraft.value = s.mcVersion
})

const { data: versions, status } = await useFetch<Version[]>(
  () => `/api/loaders/${loader.value}/minecraft`,
  { query: { snapshots }, default: () => [] },
)
// Only the current version and newer: worlds don't go back.
const items = computed(() => {
  const list = versions.value ?? []
  const at = list.findIndex((v) => v.id === server.value?.mcVersion)
  return (at >= 0 ? list.slice(0, at + 1) : list).map((v) => ({
    label:
      v.id === server.value?.mcVersion
        ? `${v.id} (current)`
        : v.stable
          ? v.id
          : `${v.id} (snapshot)`,
    value: v.id,
  }))
})

const dirty = computed(
  () =>
    !!server.value &&
    !!minecraft.value &&
    (loader.value !== server.value.loader || minecraft.value !== server.value.mcVersion),
)

const loading = ref(false)
async function review() {
  if (!server.value) return
  loading.value = true
  try {
    const { spec } = await $fetch<{ spec: Record<string, unknown> }>(
      `/api/servers/${server.value.name}/spec` as string,
    )
    await change.value?.propose(
      { ...spec, loader: { type: loader.value, minecraft: minecraft.value } },
      { title: 'Change version' },
    )
  } catch (err) {
    toast.add({ title: "Couldn't make a plan", description: errorMessage(err), color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section v-if="server" class="rounded-lg border border-default p-5">
    <h2 class="text-base font-semibold">Version</h2>
    <p class="mt-1 text-sm text-muted">
      Upgrading takes a backup first. The world is upgraded when the server starts, and can only go
      back by restoring that backup. <HelpLink to="content#updates" />
    </p>
    <div class="mt-4 grid gap-4 sm:grid-cols-2">
      <UFormField label="Loader">
        <USelect v-model="loader" :items="loaderItems" class="w-full" data-e2e="version-loader" />
      </UFormField>
      <UFormField label="Minecraft">
        <USelect
          v-model="minecraft"
          :items="items"
          :loading="status === 'pending'"
          class="w-full"
          data-e2e="version-minecraft"
        />
      </UFormField>
    </div>
    <div class="mt-4 flex items-center justify-between gap-4">
      <USwitch v-model="snapshots" label="Show snapshots" />
      <UButton
        label="Review change"
        icon="i-lucide-list-checks"
        :disabled="!dirty"
        :loading="loading"
        @click="review"
      />
    </div>
    <SpecChange ref="change" :server="server.name" @applied="refresh()" />
  </section>
</template>
