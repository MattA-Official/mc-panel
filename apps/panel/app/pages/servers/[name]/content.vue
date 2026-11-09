<script setup lang="ts">
type Kind = 'mod' | 'plugin' | 'datapack'
interface Item {
  source: 'modrinth' | 'url' | 'vanillatweaks'
  projectId: string
  slug: string
  title: string
  versionNumber: string
  kind: Kind
  path: string
  asked: boolean
  requiredBy: string[]
}
type Wanted =
  | { modrinth: string; version?: string; kind?: Kind }
  | { url: string; kind: Kind }
  | { vanillatweaks: string; tweak?: 'datapack' | 'crafting' }
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

const KIND_LABEL: Record<Kind, string> = { mod: 'Mod', plugin: 'Plugin', datapack: 'Datapack' }

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
  spec.content = spec.content.filter((c) => {
    if ('modrinth' in c) return c.modrinth !== item.slug && c.modrinth !== item.projectId
    if ('vanillatweaks' in c) {
      return (
        `${c.tweak ?? 'datapack'}:${c.vanillatweaks}`.toLowerCase() !== item.projectId.toLowerCase()
      )
    }
    return c.url !== item.projectId
  })
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
    label: { mod: 'Mods', plugin: 'Plugins', datapack: 'Datapacks' }[k],
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
const pendingLabel = (w: Wanted) =>
  'modrinth' in w ? w.modrinth : 'vanillatweaks' in w ? w.vanillatweaks : w.url

// Vanilla Tweaks: tick packs by category, then review.
interface VtPack {
  name: string
  display: string
  description: string
  version: string
}
interface VtCategory {
  name: string
  packs: VtPack[]
}
const vtOpen = ref(false)
const vtTab = ref<'datapack' | 'crafting'>('datapack')
const vtFilter = ref('')
const vtPicked = ref(new Set<string>())
const {
  data: vt,
  error: vtError,
  status: vtStatus,
  execute: loadVt,
} = useFetch<{ version: string; datapacks: VtCategory[]; crafting: VtCategory[] }>(
  () => `/api/servers/${name.value}/content/vanillatweaks`,
  { immediate: false, server: false },
)
const vtKey = (tweak: string, category: string, pack: string) => `${tweak}:${category}/${pack}`
watch(vtOpen, async (o) => {
  if (!o) return
  if (!vt.value) loadVt()
  const spec = await currentSpec()
  vtPicked.value = new Set(
    spec.content.flatMap((c) =>
      'vanillatweaks' in c ? [`${c.tweak ?? 'datapack'}:${c.vanillatweaks}`] : [],
    ),
  )
})
const vtCategories = computed(() => {
  const list = (vtTab.value === 'crafting' ? vt.value?.crafting : vt.value?.datapacks) ?? []
  const q = vtFilter.value.trim().toLowerCase()
  return list
    .map((c) => ({
      ...c,
      packs: q
        ? c.packs.filter(
            (p) => p.display.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
          )
        : c.packs,
    }))
    .filter((c) => c.packs.length)
})
function toggleVt(key: string, on: boolean) {
  const next = new Set(vtPicked.value)
  if (on) next.add(key)
  else next.delete(key)
  vtPicked.value = next
}
async function reviewVt() {
  const spec = await currentSpec()
  const others = spec.content.filter((c) => !('vanillatweaks' in c))
  const picked: Wanted[] = [...vtPicked.value].map((key) => {
    const [tweak, pack] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
    return tweak === 'crafting'
      ? { vanillatweaks: pack, tweak: 'crafting' }
      : { vanillatweaks: pack }
  })
  spec.content = [...others, ...picked]
  vtOpen.value = false
  await change.value?.propose(spec, { title: 'Vanilla Tweaks' })
}
</script>

<template>
  <div v-if="server" class="mx-auto w-full max-w-4xl space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm text-muted">
        {{
          server.loader === 'paper'
            ? `Plugins and datapacks from Modrinth, matched to Paper and Minecraft ${server.mcVersion}.`
            : server.loader !== 'fabric'
              ? 'Datapacks from Modrinth, kept in the world folder.'
              : `Mods and datapacks from Modrinth, matched to Fabric and Minecraft ${server.mcVersion}.`
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
        <UButton
          label="Vanilla Tweaks"
          icon="i-lucide-sparkles"
          color="neutral"
          variant="outline"
          @click="vtOpen = true"
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
        server.loader === 'paper'
          ? 'Add plugins for tools, protection or new things to do.'
          : server.loader !== 'fabric'
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

    <USlideover
      v-model:open="vtOpen"
      title="Vanilla Tweaks"
      :description="
        vt ? `Packs for Minecraft ${vt.version}. Tick what you want, untick to remove.` : undefined
      "
      :ui="{ content: 'w-full sm:max-w-xl' }"
    >
      <template #body>
        <div class="space-y-4">
          <UAlert
            v-if="vtError"
            color="warning"
            variant="subtle"
            icon="i-lucide-cloud-off"
            :title="errorMessage(vtError)"
          />
          <p v-else-if="vtStatus === 'pending'" class="text-sm text-muted">
            Loading the catalogue…
          </p>
          <template v-if="vt">
            <UTabs
              v-model="vtTab"
              :items="[
                { label: 'Datapacks', value: 'datapack' },
                { label: 'Crafting tweaks', value: 'crafting' },
              ]"
              :content="false"
              class="w-full"
            />
            <UInput
              v-model="vtFilter"
              icon="i-lucide-search"
              placeholder="Filter"
              aria-label="Filter Vanilla Tweaks"
              class="w-full"
            />
            <details v-for="c in vtCategories" :key="c.name" open class="group">
              <summary class="cursor-pointer py-1 text-sm font-semibold">
                {{ c.name.replace(/\//g, ' › ') }}
                <span class="font-normal text-dimmed">({{ c.packs.length }})</span>
              </summary>
              <ul class="space-y-2 py-2 pl-1">
                <li v-for="p in c.packs" :key="p.name">
                  <UCheckbox
                    :model-value="vtPicked.has(vtKey(vtTab, c.name, p.name))"
                    :label="p.display"
                    :description="p.description || undefined"
                    @update:model-value="(v) => toggleVt(vtKey(vtTab, c.name, p.name), v === true)"
                  />
                </li>
              </ul>
            </details>
          </template>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full items-center justify-between gap-2">
          <span class="text-sm text-muted">{{ vtPicked.size }} chosen</span>
          <UButton label="Review" icon="i-lucide-list-checks" :disabled="!vt" @click="reviewVt" />
        </div>
      </template>
    </USlideover>

    <SpecChange ref="change" :server="name" @applied="applied" />
  </div>
</template>
