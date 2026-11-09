<script setup lang="ts">
const { server, status } = useServerContext()

const address = computed(() =>
  server.value
    ? server.value.port === 25565
      ? location.hostname
      : `${location.hostname}:${server.value.port}`
    : '',
)
const copied = ref(false)
async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div v-if="server" class="grid gap-6 lg:grid-cols-[1fr_20rem]">
    <ServerConsole
      :server="server.name"
      :running="status === 'active'"
      class="h-[calc(100dvh-10rem)] min-h-80"
    />

    <aside class="space-y-4">
      <div class="rounded-lg border border-default p-4">
        <p class="text-xs text-muted">Address</p>
        <div class="mt-1 flex items-center gap-2">
          <code class="truncate font-mono text-base">{{ address }}</code>
          <UButton
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            size="xs"
            variant="ghost"
            color="neutral"
            aria-label="Copy address"
            @click="copy(address)"
          />
        </div>
      </div>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-default p-4 text-sm">
        <div>
          <dt class="text-xs text-muted">Version</dt>
          <dd>{{ loaderLabel(server) }}</dd>
        </div>
        <div v-if="server.loaderVersion">
          <dt class="text-xs text-muted">Fabric loader</dt>
          <dd class="font-mono">{{ server.loaderVersion }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Java</dt>
          <dd>Temurin {{ server.javaMajor }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Memory</dt>
          <dd>{{ formatMemory(server.memoryMb) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Short name</dt>
          <dd class="font-mono">{{ server.name }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Created</dt>
          <dd>
            {{ new Date(server.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) }}
          </dd>
        </div>
      </dl>
    </aside>
  </div>
</template>
