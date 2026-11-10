<script setup lang="ts">
const emit = defineEmits<{ saved: [] }>()
const { server } = useServerContext()
const toast = useToast()

type Field =
  | { key: string; label: string; type: 'motd'; help?: string }
  | { key: string; label: string; type: 'number'; min: number; max: number; help?: string }
  | { key: string; label: string; type: 'bool'; help?: string }
  | { key: string; label: string; type: 'select'; options: string[]; help?: string }

const FIELDS: Field[] = [
  {
    key: 'motd',
    label: 'Message of the day',
    type: 'motd',
    help: 'Shown under the server in the multiplayer list. Select text and pick a colour or style, or turn on Show codes to type § codes.',
  },
  {
    key: 'difficulty',
    label: 'Difficulty',
    type: 'select',
    options: ['peaceful', 'easy', 'normal', 'hard'],
  },
  {
    key: 'gamemode',
    label: 'Game mode',
    type: 'select',
    options: ['survival', 'creative', 'adventure', 'spectator'],
  },
  {
    key: 'max-players',
    label: 'Max players',
    type: 'number',
    min: 1,
    max: 1000,
    help: 'How many can be on at once.',
  },
  {
    key: 'view-distance',
    label: 'View distance',
    type: 'number',
    min: 3,
    max: 32,
    help: 'Chunks sent to players.',
  },
  {
    key: 'simulation-distance',
    label: 'Simulation distance',
    type: 'number',
    min: 3,
    max: 32,
    help: 'Chunks that tick.',
  },
  {
    key: 'spawn-protection',
    label: 'Spawn protection',
    type: 'number',
    min: 0,
    max: 1000,
    help: 'Radius only operators can build in.',
  },
  { key: 'pvp', label: 'PvP', type: 'bool', help: 'Players can hurt each other.' },
  {
    key: 'hardcore',
    label: 'Hardcore',
    type: 'bool',
    help: 'Hardest difficulty, and dying bans you from the server.',
  },
  {
    key: 'allow-flight',
    label: 'Allow flight',
    type: 'bool',
    help: 'Needed by some mods; stops "kicked for flying".',
  },
  {
    key: 'online-mode',
    label: 'Online mode',
    type: 'bool',
    help: 'Checks accounts with Mojang. Turning this off lets anyone join as anyone.',
  },
  { key: 'white-list', label: 'Whitelist', type: 'bool', help: 'Only listed players can join.' },
  {
    key: 'enforce-whitelist',
    label: 'Enforce whitelist',
    type: 'bool',
    help: 'Kick players removed from the whitelist.',
  },
]
const FIELD_KEYS = new Set(FIELDS.map((f) => f.key))

// Minecraft's defaults, shown until the server first writes its full file.
const DEFAULTS: Record<string, string> = {
  motd: 'A Minecraft Server',
  difficulty: 'easy',
  gamemode: 'survival',
  'max-players': '20',
  'view-distance': '10',
  'simulation-distance': '10',
  'spawn-protection': '16',
  pvp: 'true',
  'allow-flight': 'false',
  hardcore: 'false',
  'white-list': 'false',
  'enforce-whitelist': 'false',
  'online-mode': 'true',
}

const url = computed(() => `/api/servers/${server.value?.name}/properties`)
const { data, refresh } = await useFetch<{ values: Record<string, string>; managed: string[] }>(url)
const base = computed<Record<string, string>>(() => ({
  ...DEFAULTS,
  ...(data.value?.values ?? {}),
}))
const draft = ref<Record<string, string>>({})
watch(base, (b) => (draft.value = { ...b }), { immediate: true })
// A port change from Resources rewrites server-port; show it.
watch(
  () => server.value?.port,
  () => refresh(),
)

const changes = computed(() => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(draft.value)) if (base.value[k] !== v) out[k] = v
  return out
})
const dirty = computed(() => Object.keys(changes.value).length > 0)

const others = computed(() =>
  Object.keys(draft.value)
    .filter((k) => !FIELD_KEYS.has(k))
    .sort(),
)
const managed = computed(() => new Set(data.value?.managed ?? []))

const asBool = (key: string) =>
  computed({
    get: () => draft.value[key] === 'true',
    set: (v: boolean) => (draft.value[key] = String(v)),
  })
const asNumber = (key: string) =>
  computed({
    get: () => (draft.value[key] ? Number(draft.value[key]) : undefined),
    set: (v: number | undefined) =>
      (draft.value[key] = v === undefined || v === null ? '' : String(v)),
  })
const bools = Object.fromEntries(
  FIELDS.filter((f) => f.type === 'bool').map((f) => [f.key, asBool(f.key)]),
)
const numbers = Object.fromEntries(
  FIELDS.filter((f) => f.type === 'number').map((f) => [f.key, asNumber(f.key)]),
)

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch(url.value as string, { method: 'PATCH', body: { values: changes.value } })
    await refresh()
    emit('saved')
    toast.add({ title: 'Settings saved', color: 'success' })
  } catch (err) {
    toast.add({ title: "Couldn't save", description: errorMessage(err), color: 'error' })
  } finally {
    saving.value = false
  }
}

const showAll = ref(false)
const discard = () => (draft.value = { ...base.value })

// Ctrl/⌘ + S saves, from a field too (#108).
defineShortcuts({
  meta_s: { usingInput: true, handler: () => dirty.value && !saving.value && void save() },
})
</script>

<template>
  <section class="rounded-lg border border-default p-5">
    <h2 class="text-base font-semibold">Game settings</h2>
    <p v-if="!data" class="mt-4 text-sm text-muted">Loading…</p>
    <ServerIcon
      v-if="data"
      class="mt-4 border-b border-default pb-5"
      :motd="draft.motd ?? ''"
      :max-players="numbers['max-players']!.value"
    />
    <div v-if="data" class="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2">
      <template v-for="f in FIELDS" :key="f.key">
        <UFormField
          v-if="f.type === 'motd'"
          :label="f.label"
          :description="f.help"
          class="sm:col-span-2"
        >
          <MotdEditor
            v-model="draft[f.key]!"
            :name="server?.displayName ?? server?.name ?? 'Minecraft Server'"
            :max-players="numbers['max-players']!.value"
            :icon="server?.icon"
          />
        </UFormField>
        <UFormField v-else-if="f.type === 'select'" :label="f.label" :description="f.help">
          <USelect v-model="draft[f.key]" :items="f.options" class="w-full capitalize" />
        </UFormField>
        <UFormField v-else-if="f.type === 'number'" :label="f.label" :description="f.help">
          <UInputNumber v-model="numbers[f.key]!.value" :min="f.min" :max="f.max" class="w-36" />
        </UFormField>
        <div v-else class="flex items-start gap-3">
          <USwitch v-model="bools[f.key]!.value" :aria-label="f.label" class="mt-0.5" />
          <div class="text-sm">
            <p class="font-medium">{{ f.label }}</p>
            <p v-if="f.help" class="text-muted">{{ f.help }}</p>
          </div>
        </div>
      </template>
    </div>

    <div class="mt-6 border-t border-default pt-4">
      <UButton
        :label="showAll ? 'Hide other properties' : `All other properties (${others.length})`"
        :icon="showAll ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        variant="ghost"
        color="neutral"
        size="sm"
        @click="showAll = !showAll"
      />
      <div v-if="showAll" class="mt-3 divide-y divide-default rounded-md border border-default">
        <div
          v-for="key in others"
          :key="key"
          class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 px-3 py-1.5"
        >
          <label :for="`prop-${key}`" class="truncate font-mono text-xs">{{ key }}</label>
          <UInput
            :id="`prop-${key}`"
            v-model="draft[key]"
            size="sm"
            class="font-mono"
            :disabled="managed.has(key)"
            :title="managed.has(key) ? 'Managed by Flytower' : undefined"
          />
        </div>
      </div>
    </div>

    <div
      v-if="dirty"
      class="sticky bottom-4 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-elevated p-3 shadow-lg"
      data-e2e="unsaved-bar"
    >
      <p class="text-sm">
        {{
          Object.keys(changes).length === 1
            ? '1 unsaved change'
            : `${Object.keys(changes).length} unsaved changes`
        }}
      </p>
      <div class="flex gap-2">
        <UButton
          label="Discard"
          color="neutral"
          variant="ghost"
          :disabled="saving"
          @click="discard"
        />
        <UButton label="Save" :loading="saving" @click="save" />
      </div>
    </div>
  </section>
</template>
