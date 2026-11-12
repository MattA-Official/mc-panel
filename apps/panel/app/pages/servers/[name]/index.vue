<script setup lang="ts">
const { server, status, health } = useServerContext()
const route = useRoute()
// Without the console, the server opens on its players instead.
const can = useCan()
if (!can('console.read', String(route.params.name))) {
  await navigateTo(`/servers/${String(route.params.name)}/players`, { replace: true })
}

const address = computed(() =>
  server.value ? connectAddress(server.value, location.hostname) : '',
)
/** Crashes nobody has dismissed yet, for the count on the Crashes button. */
const { data: events, refresh: refreshEvents } = await useFetch<
  { kind: ServerEventKind; dismissed: boolean }[]
>(() => `/api/servers/${String(route.params.name)}/events`, { default: () => [] })
watch(
  () => health.value.crash?.id,
  () => refreshEvents(),
)
const unseenCrashes = computed(
  () => events.value.filter((e) => e.kind !== 'recovered' && !e.dismissed).length,
)
const logsLink = (logs: string) => ({ query: { ...route.query, logs } })

const { copied, copy: copyText } = useCopyButton()
const copy = (text: string) => copyText(text, 'Address')
</script>

<template>
  <div v-if="server" class="space-y-4">
    <CrashBanner />
    <div class="flex gap-2 lg:hidden">
      <UButton
        label="View logs"
        icon="i-lucide-scroll-text"
        color="neutral"
        variant="outline"
        :to="logsLink('')"
      />
      <UButton
        label="Crashes"
        icon="i-lucide-octagon-alert"
        color="neutral"
        variant="outline"
        :to="logsLink('crashes')"
      >
        <template v-if="unseenCrashes" #trailing>
          <UBadge :label="String(unseenCrashes)" color="error" variant="subtle" size="sm" />
        </template>
      </UButton>
    </div>
    <div class="grid gap-6 lg:grid-cols-[1fr_20rem]">
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
            <dt class="text-xs text-muted">{{ LOADERS[server.loader].versionLabel }}</dt>
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
              {{ formatDate(server.createdAt) }}
            </dd>
          </div>
        </dl>
        <div class="hidden space-y-2 lg:block">
          <UButton
            label="View logs"
            icon="i-lucide-scroll-text"
            color="neutral"
            variant="outline"
            block
            class="justify-start"
            :to="logsLink('')"
            data-e2e="open-logs"
          />
          <UButton
            label="Crashes"
            icon="i-lucide-octagon-alert"
            color="neutral"
            variant="outline"
            block
            class="justify-start"
            :to="logsLink('crashes')"
            data-e2e="open-crashes"
          >
            <template v-if="unseenCrashes" #trailing>
              <UBadge
                :label="`${unseenCrashes} new`"
                color="error"
                variant="subtle"
                size="sm"
                class="ms-auto"
              />
            </template>
          </UButton>
        </div>
      </aside>
    </div>
  </div>
</template>
