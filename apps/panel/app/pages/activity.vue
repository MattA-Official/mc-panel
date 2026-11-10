<script setup lang="ts">
useHead({ title: 'Activity' })

interface Item {
  id: number
  at: string
  user: string | null
  action: string
  kind: AuditKind
  target: string | null
  text: string
}

const { data: servers } = await useFetch<Server[]>('/api/servers', { default: () => [] })
const server = ref<string>('all')
const kind = ref<string>('all')
const items = ref<Item[]>([])
const next = ref<number | null>(null)
const loading = ref(false)

async function load(more = false) {
  loading.value = true
  try {
    const r = await $fetch<{ items: Item[]; next: number | null }>('/api/audit', {
      query: {
        ...(server.value !== 'all' ? { server: server.value } : {}),
        ...(kind.value !== 'all' ? { kind: kind.value } : {}),
        ...(more && next.value ? { before: next.value } : {}),
      },
    })
    items.value = more ? [...items.value, ...r.items] : r.items
    next.value = r.next
  } finally {
    loading.value = false
  }
}
watch([server, kind], () => load())
await load()

const serverItems = computed(() => [
  { label: 'All servers', value: 'all' },
  ...servers.value.map((s) => ({ label: s.displayName, value: s.name })),
])
const kindItems = [
  { label: 'Everything', value: 'all' },
  ...Object.entries(AUDIT_KINDS).map(([value, label]) => ({ label, value })),
]
const ICONS: Record<AuditKind, string> = {
  servers: 'i-lucide-server',
  content: 'i-lucide-package',
  backups: 'i-lucide-archive',
  world: 'i-lucide-globe',
  players: 'i-lucide-users',
  files: 'i-lucide-folder-open',
  access: 'i-lucide-key-round',
  system: 'i-lucide-arrow-up-circle',
}
const when = (at: string) => formatDateTime(at)
</script>

<template>
  <UDashboardPanel id="activity">
    <template #header>
      <UDashboardNavbar title="Activity" />
    </template>
    <template #body>
      <div class="mx-auto w-full max-w-3xl space-y-4">
        <div class="flex flex-wrap gap-3">
          <USelect v-model="server" :items="serverItems" class="w-48" />
          <USelect v-model="kind" :items="kindItems" class="w-56" />
        </div>
        <UEmpty
          v-if="!items.length && !loading"
          icon="i-lucide-history"
          title="Nothing here yet"
          description="Changes made in Flytower show up here."
        />
        <ul v-else class="divide-y divide-default rounded-lg border border-default">
          <li
            v-for="i in items"
            :key="i.id"
            class="flex gap-3 p-3 text-sm"
            data-e2e="activity-item"
          >
            <UIcon :name="ICONS[i.kind]" class="mt-0.5 size-4 shrink-0 text-muted" />
            <div class="min-w-0 flex-1">
              <p class="break-words">{{ i.text }}</p>
              <p class="text-xs text-muted">
                {{ i.user ?? 'Someone since removed' }} · {{ when(i.at) }}
              </p>
            </div>
          </li>
        </ul>
        <div v-if="next" class="flex justify-center">
          <UButton
            label="Older"
            color="neutral"
            variant="outline"
            :loading="loading"
            @click="load(true)"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
