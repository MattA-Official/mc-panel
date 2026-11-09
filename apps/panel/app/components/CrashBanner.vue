<script setup lang="ts">
const { server, health, status } = useServerContext()
const toast = useToast()

const crash = computed(() => health.value.crash)
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const title = computed(() => {
  const c = crash.value
  if (!c) return ''
  if (c.kind === 'crash-loop') return `Kept crashing, so it was left stopped (${when(c.at)})`
  if (c.kind === 'oom') return `Ran out of memory at ${when(c.at)}`
  return `Crashed at ${when(c.at)}`
})
const description = computed(() => {
  const c = crash.value
  if (!c) return ''
  const after =
    c.kind === 'crash-loop'
      ? status.value === 'active'
        ? ' It has been started again.'
        : ' Start it again once the cause is fixed.'
      : status.value === 'activating'
        ? ' It will be restarted in a moment.'
        : status.value === 'active'
          ? ' It was restarted automatically.'
          : ''
  return `${c.cause ?? ''}${after}`.trim()
})

async function dismiss() {
  const c = crash.value
  if (!c || !server.value) return
  try {
    await $fetch(`/api/servers/${server.value.name}/events/${c.id}/dismiss` as string, {
      method: 'POST',
    })
    health.value.crash = null
  } catch (err) {
    toast.add({ title: "Couldn't dismiss it", description: errorMessage(err), color: 'error' })
  }
}

const actions = computed(() => {
  const c = crash.value
  const name = server.value?.name ?? ''
  return [
    ...(c?.crashReport
      ? [
          {
            label: 'Open crash report',
            icon: 'i-lucide-file-warning',
            color: 'error' as const,
            to: crashReportLink(name, c.crashReport),
          },
        ]
      : []),
    {
      label: 'Crash history',
      color: 'neutral' as const,
      variant: 'outline' as const,
      to: { path: `/servers/${name}/logs`, query: { log: 'crashes' } },
    },
  ]
})
</script>

<template>
  <UAlert
    v-if="crash"
    :color="crash.kind === 'crash-loop' ? 'error' : 'warning'"
    variant="subtle"
    :icon="crash.kind === 'oom' ? 'i-lucide-memory-stick' : 'i-lucide-octagon-alert'"
    :title="title"
    :description="description"
    :actions="actions"
    close
    data-e2e="crash-banner"
    @update:open="(v: boolean) => !v && dismiss()"
  />
</template>
