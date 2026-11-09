<script setup lang="ts">
type Kind = 'mod' | 'datapack'
interface Item {
  source: 'modrinth' | 'url'
  projectId: string
  slug: string
  title: string
  versionNumber: string
  kind: Kind
  path: string
  asked: boolean
  requiredBy: string[]
}
type Wanted = { modrinth: string; version?: string; kind?: Kind } | { url: string; kind: Kind }
interface Listing {
  accepts: Kind[]
  items: Item[]
  pending: Wanted[]
  unmanaged: { path: string; kind: Kind }[]
}
interface Hit {
  projectId: string
  slug: string
  title: string
  description: string
  author: string
  iconUrl: string | null
  downloads: number
  kind: Kind
  installed: boolean
}
interface Update {
  label: string
  from?: string
  to?: string
}

const { server } = useServerContext()
const name = computed(() => server.value?.name ?? '')
const toast = useToast()

const { data, refresh } = await useFetch<Listing>(() => `/api/servers/${name.value}/content`)
const {
  data: updates,
  refresh: refreshUpdates,
  status: updatesStatus,
} = await useFetch<{ updates: Update[] }>(() => `/api/servers/${name.value}/content/updates`, {
  server: false,
  lazy: true,
})
const updateFor = (title: string) => updates.value?.updates.find((u) => u.label === title)

const KIND_LABEL: Record<Kind, string> = { mod: 'Mod', datapack: 'Datapack' }

// Changes go through a plan the person reviews.
const change = ref<{
  propose: (spec: unknown, o: { title: string; upgrade?: true | string[] }) => Promise<void>
} | null>(null)

async function currentSpec() {
  return (
    await $fetch<{ spec: { content: Wanted[] } & Record<string, unknown> }>(
      `/api/servers/${name.value}/spec` as string,
    )
  ).spec
}

async function add(hit: Hit) {
  const spec = await currentSpec()
  spec.content = [...spec.content, { modrinth: hit.slug, kind: hit.kind }]
  addOpen.value = false
  await change.value?.propose(spec, { title: `Add ${hit.title}` })
}

async function remove(item: Item) {
  const spec = await currentSpec()
  spec.content = spec.content.filter((c) =>
    'modrinth' in c
      ? c.modrinth !== item.slug && c.modrinth !== item.projectId
      : c.url !== item.projectId,
  )
  await change.value?.propose(spec, { title: `Remove ${item.title}` })
}

function update(item?: Item) {
  return change.value?.propose(null, {
    title: item ? `Update ${item.title}` : 'Update everything',
    upgrade: item ? [item.projectId] : true,
  })
}

function applied() {
  refresh()
  refreshUpdates()
}

// Search.
const addOpen = ref(false)
const kind = ref<Kind>('mod')
const query = ref('')
const hits = ref<Hit[]>([])
const total = ref(0)
const searching = ref(false)
const searchError = ref('')
let timer: ReturnType<typeof setTimeout> | undefined

const kindTabs = computed(() =>
  (data.value?.accepts ?? ['datapack']).map((k) => ({
    label: k === 'mod' ? 'Mods' : 'Datapacks',
    value: k,
  })),
)

async function search() {
  searching.value = true
  searchError.value = ''
  try {
    const r = await $fetch<{ hits: Hit[]; total: number }>(
      `/api/servers/${name.value}/content/search` as string,
      { query: { kind: kind.value, q: query.value } },
    )
    hits.value = r.hits
    total.value = r.total
  } catch (err) {
    searchError.value = errorMessage(err)
    hits.value = []
  } finally {
    searching.value = false
  }
}
watch([query, kind], () => {
  clearTimeout(timer)
  timer = setTimeout(search, 350)
})
watch(addOpen, (o) => {
  if (!o) return
  if (!data.value?.accepts.includes(kind.value)) kind.value = data.value?.accepts[0] ?? 'datapack'
  search()
})
onBeforeUnmount(() => clearTimeout(timer))

function count(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)
}
const pendingLabel = (w: Wanted) => ('modrinth' in w ? w.modrinth : w.url)
</script>

<template>
  <div v-if="server" class="mx-auto w-full max-w-4xl space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm text-muted">
        {{
          server.loader === 'vanilla'
            ? 'Datapacks from Modrinth, kept in the world folder.'
            : 'Mods and datapacks from Modrinth, matched to Fabric and Minecraft ' +
              server.mcVersion +
              '.'
        }}
      </p>
      <div class="flex gap-2">
        <UButton
          v-if="updates?.updates.length"
          :label="`Update ${updates.updates.length}`"
          icon="i-lucide-arrow-up-circle"
          color="neutral"
          variant="outline"
          @click="update()"
        />
        <UButton label="Add content" icon="i-lucide-plus" @click="addOpen = true" />
      </div>
    </div>

    <UAlert
      v-if="data?.pending.length"
      color="info"
      variant="subtle"
      icon="i-lucide-package"
      title="Not installed yet"
      :description="`The spec lists ${data.pending.map(pendingLabel).join(', ')}, which hasn't been installed. Review the plan to install it.`"
      :actions="[
        {
          label: 'Review',
          color: 'info',
          variant: 'outline',
          onClick: () => change?.propose(null, { title: 'Install content' }),
        },
      ]"
    />

    <div v-if="data?.items.length" class="overflow-x-auto rounded-md border border-default">
      <table class="w-full text-sm">
        <thead class="bg-elevated/50 text-left text-xs text-muted">
          <tr>
            <th class="px-3 py-2 font-medium">Name</th>
            <th class="px-3 py-2 font-medium">Version</th>
            <th class="hidden px-3 py-2 font-medium sm:table-cell">Kind</th>
            <th class="px-3 py-2"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <tr v-for="item in data.items" :key="item.path">
            <td class="px-3 py-2">
              <p class="font-medium">{{ item.title }}</p>
              <p v-if="!item.asked" class="text-xs text-dimmed">
                Needed by {{ item.requiredBy.join(', ') || 'another item' }}
              </p>
            </td>
            <td class="px-3 py-2 font-mono text-xs">
              {{ item.versionNumber }}
              <UBadge
                v-if="updateFor(item.title)"
                class="ml-1 font-sans"
                size="sm"
                color="info"
                variant="subtle"
                :label="`${updateFor(item.title)!.to} available`"
              />
            </td>
            <td class="hidden px-3 py-2 text-muted sm:table-cell">
              {{ KIND_LABEL[item.kind] }}
            </td>
            <td class="px-3 py-2 text-right whitespace-nowrap">
              <UButton
                v-if="updateFor(item.title)"
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-arrow-up"
                :aria-label="`Update ${item.title}`"
                @click="update(item)"
              />
              <UButton
                v-if="item.asked"
                size="xs"
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                :aria-label="`Remove ${item.title}`"
                @click="remove(item)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <UEmpty
      v-else-if="data && !data.pending.length"
      icon="i-lucide-package"
      title="Nothing installed yet"
      :description="
        server.loader === 'vanilla'
          ? 'Add a datapack to change how the world plays.'
          : 'Add mods for performance, tools or new things to do.'
      "
    />
    <p v-if="updatesStatus === 'pending'" class="text-xs text-dimmed">Checking for updates…</p>

    <section v-if="data?.unmanaged.length" class="space-y-2">
      <h2 class="text-sm font-semibold">Added by hand</h2>
      <p class="text-sm text-muted">
        Flytower leaves these alone. Manage them in Files, or remove them and add the same thing
        here to keep it updated.
      </p>
      <ul class="space-y-0.5 font-mono text-xs text-muted">
        <li v-for="u in data.unmanaged" :key="u.path">{{ u.path }}</li>
      </ul>
    </section>

    <USlideover v-model:open="addOpen" title="Add content" :ui="{ content: 'w-full sm:max-w-xl' }">
      <template #body>
        <div class="space-y-4">
          <UTabs
            v-if="kindTabs.length > 1"
            v-model="kind"
            :items="kindTabs"
            :content="false"
            class="w-full"
          />
          <UInput
            v-model="query"
            icon="i-lucide-search"
            placeholder="Search Modrinth"
            aria-label="Search Modrinth"
            class="w-full"
            :loading="searching"
            autofocus
          />
          <UAlert v-if="searchError" color="error" variant="subtle" :title="searchError" />
          <ul class="divide-y divide-default">
            <li v-for="h in hits" :key="h.projectId" class="flex items-start gap-3 py-3">
              <img
                v-if="h.iconUrl"
                :src="h.iconUrl"
                alt=""
                class="size-10 shrink-0 rounded-md bg-elevated object-cover"
                loading="lazy"
              />
              <div v-else class="size-10 shrink-0 rounded-md bg-elevated" />
              <div class="min-w-0 flex-1">
                <p class="font-medium">
                  {{ h.title }}
                  <span class="text-xs font-normal text-dimmed">by {{ h.author }}</span>
                </p>
                <p class="line-clamp-2 text-sm text-muted">{{ h.description }}</p>
                <p class="text-xs text-dimmed">{{ count(h.downloads) }} downloads</p>
              </div>
              <UButton
                v-if="!h.installed"
                size="sm"
                label="Add"
                :aria-label="`Add ${h.title}`"
                @click="add(h)"
              />
              <UBadge v-else color="neutral" variant="subtle" label="Installed" />
            </li>
          </ul>
          <p v-if="!searching && !hits.length && !searchError" class="text-sm text-muted">
            Nothing found for this server's version.
          </p>
        </div>
      </template>
    </USlideover>

    <SpecChange ref="change" :server="name" @applied="applied" />
  </div>
</template>
