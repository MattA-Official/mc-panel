<script setup lang="ts">
/** The server's public status page: on or off, its description and what it shows. */
import {
  DESCRIPTION_MAX,
  samePublicPage,
  type PlayerVisibility,
  type PublicPage,
} from '#shared/public-page'

const { server, refresh } = useServerContext()
const toast = useToast()

const copy = (p: PublicPage): PublicPage => ({
  ...p,
  show: { ...p.show },
  pack: { ...p.pack, extras: p.pack.extras.map((e) => ({ ...e })) },
})
const form = ref<PublicPage | null>(server.value ? copy(server.value.publicPage) : null)
watch(
  () => server.value?.publicPage,
  (p) => p && (form.value = copy(p)),
)
const dirty = computed(
  () => !!server.value && !!form.value && !samePublicPage(form.value, server.value.publicPage),
)

const url = computed(() =>
  server.value ? `${useRequestURL().origin}/s/${encodeURIComponent(server.value.name)}` : '',
)
const live = computed(() => !!server.value?.publicPage.enabled)
// On its own hostname too, once Caddy serves it (see docs/status-page.md).
const hostUrl = computed(() => (server.value?.hostname ? `https://${server.value.hostname}` : null))

const saving = ref(false)
async function save() {
  if (!server.value || !form.value) return
  saving.value = true
  try {
    await $fetch(`/api/servers/${server.value.name}/public-page` as string, {
      method: 'PATCH',
      body: form.value,
    })
    await refresh()
    toast.add({
      title: form.value.enabled ? 'Public page saved' : 'Public page turned off',
      color: 'success',
    })
  } catch (err) {
    toast.add({ title: "Couldn't save that", description: errorMessage(err), color: 'error' })
  } finally {
    saving.value = false
  }
}

const copied = ref(false)
async function copyLink() {
  await navigator.clipboard.writeText(url.value).catch(() => {})
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

// The players' modpack: what's in it, worked out by the panel from the server's content.
interface PackPreview {
  unavailable: string | null
  included: { title: string; kind: string; version: string; from: 'server' | 'extra' }[]
  skipped: { title: string; reason: string }[]
  empty: boolean
}
const fabric = computed(() => server.value?.loader === 'fabric')
const {
  data: pack,
  error: packError,
  pending: packPending,
  refresh: refreshPack,
} = useFetch<PackPreview>(() => `/api/servers/${server.value?.name}/pack`, {
  immediate: false,
  server: false,
})
watch(
  () => [live.value, fabric.value, server.value?.publicPage.pack.extras.length] as const,
  ([on, f]) => on && f && refreshPack(),
  { immediate: true },
)
const KIND_LABEL: Record<string, string> = {
  mod: 'Mod',
  shader: 'Shader pack',
  resourcepack: 'Resource pack',
}

const newExtra = ref('')
function addExtra() {
  const slug = newExtra.value.trim().replace(/^https?:\/\/modrinth\.com\/[a-z]+\//, '')
  if (!form.value || !slug || !/^[\w.-]{1,64}$/.test(slug)) return
  if (!form.value.pack.extras.some((e) => e.modrinth === slug)) {
    form.value.pack.extras.push({ modrinth: slug })
  }
  newExtra.value = ''
}
function removeExtra(i: number) {
  form.value?.pack.extras.splice(i, 1)
}

const PLAYER_ITEMS: { label: string; value: PlayerVisibility; description: string }[] = [
  {
    label: 'How many are online',
    value: 'count',
    description: 'For example "3 of 20 players online".',
  },
  {
    label: 'Names and heads',
    value: 'names',
    description: "Everyone who's on, by name, with their face.",
  },
  { label: 'Nothing', value: 'none', description: 'The page says nothing about players.' },
]
</script>

<template>
  <section v-if="server && form" class="rounded-lg border border-default p-5">
    <h2 class="text-base font-semibold">Public page</h2>
    <p class="mt-1 text-sm text-muted">
      A page anyone can open without signing in, with the address to join, whether the server is up
      and who's on. Useful to link from a Discord server or a website.
    </p>

    <div
      v-if="live"
      class="mt-4 flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-elevated px-3 py-2"
    >
      <UIcon name="i-lucide-globe" class="shrink-0 text-muted" />
      <a
        :href="url"
        target="_blank"
        rel="noopener"
        class="min-w-0 truncate font-mono text-sm text-primary hover:underline"
        data-e2e="public-page-link"
        >{{ url }}</a
      >
      <UButton
        :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
        :aria-label="copied ? 'Copied' : 'Copy link'"
        size="xs"
        color="neutral"
        variant="ghost"
        @click="copyLink"
      />
    </div>
    <p v-if="live && hostUrl" class="mt-2 text-sm text-muted" data-e2e="public-page-host">
      Also at
      <a
        :href="hostUrl"
        target="_blank"
        rel="noopener"
        class="font-mono text-primary hover:underline"
        >{{ hostUrl }}</a
      >, the server's own address. Its certificate is fetched the first time someone opens it.
    </p>

    <div class="mt-4 space-y-5">
      <USwitch
        v-model="form.enabled"
        label="Show a public page for this server"
        description="Off, the page doesn't exist: its address shows the same 'nothing here' as any other."
        data-e2e="public-page-enabled"
      />
      <template v-if="form.enabled">
        <UFormField
          label="Description"
          :hint="`${form.description.length} / ${DESCRIPTION_MAX}`"
          description="A few lines about the server: who it's for, the rules, when the season started."
        >
          <UTextarea
            v-model="form.description"
            :maxlength="DESCRIPTION_MAX"
            :rows="3"
            autoresize
            class="w-full"
            data-e2e="public-page-description"
          />
        </UFormField>
        <URadioGroup
          v-model="form.show.players"
          legend="Players"
          :items="PLAYER_ITEMS"
          data-e2e="public-page-players"
        />
        <UCheckbox
          v-model="form.show.version"
          label="Show the Minecraft version and loader"
          description="Helps players pick the right version in their launcher."
        />
        <div v-if="fabric" class="space-y-3 border-t border-default pt-5">
          <USwitch
            v-model="form.pack.enabled"
            label="Offer a modpack for players"
            description="A .mrpack with the server's mods that players need too, plus any extras below. It opens in the Modrinth app or Prism Launcher. Files are listed by their Modrinth downloads, never copied."
            data-e2e="public-page-pack"
          />
          <template v-if="form.pack.enabled">
            <UFormField
              label="Extras for players"
              description="Client-only mods, shader packs or resource packs from Modrinth, by their slug (the last part of the project's address), like sodium or complementary-reimagined."
            >
              <ul v-if="form.pack.extras.length" class="mb-2 space-y-1">
                <li
                  v-for="(e, i) in form.pack.extras"
                  :key="e.modrinth"
                  class="flex items-center justify-between gap-2 rounded-md bg-elevated px-3 py-1.5"
                >
                  <span class="truncate font-mono text-sm"
                    >{{ e.modrinth
                    }}<span v-if="e.version" class="text-muted"> {{ e.version }}</span></span
                  >
                  <UButton
                    icon="i-lucide-x"
                    :aria-label="`Remove ${e.modrinth}`"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    @click="removeExtra(i)"
                  />
                </li>
              </ul>
              <div class="flex gap-2">
                <UInput
                  v-model="newExtra"
                  placeholder="sodium"
                  class="min-w-0 flex-1 font-mono"
                  autocomplete="off"
                  data-e2e="public-page-extra"
                  @keydown.enter.prevent="addExtra"
                />
                <UButton label="Add" color="neutral" variant="subtle" @click="addExtra" />
              </div>
            </UFormField>
          </template>
        </div>
      </template>
    </div>

    <div
      v-if="live && fabric && server.publicPage.pack.enabled"
      class="mt-5 rounded-md border border-default p-4 text-sm"
      data-e2e="public-page-pack-preview"
    >
      <h3 class="font-semibold">What players get</h3>
      <p v-if="packPending" class="mt-1 text-muted">Working it out from Modrinth…</p>
      <p v-else-if="packError" class="mt-1 text-error">
        {{ errorMessage(packError) }}
      </p>
      <template v-else-if="pack">
        <p v-if="pack.unavailable" class="mt-1 text-muted">{{ pack.unavailable }}</p>
        <p v-else-if="pack.empty" class="mt-1 text-muted">
          Nothing yet: none of the server's mods run on players' computers. The page won't offer a
          modpack until there's something in it.
        </p>
        <ul v-else class="mt-2 space-y-0.5">
          <li v-for="i in pack.included" :key="i.title" class="flex justify-between gap-3">
            <span class="truncate">{{ i.title }}</span>
            <span class="shrink-0 text-muted"
              >{{ KIND_LABEL[i.kind] ?? i.kind }} {{ i.version }}</span
            >
          </li>
        </ul>
        <details v-if="pack.skipped.length" class="mt-3">
          <summary class="cursor-pointer text-muted">Left out ({{ pack.skipped.length }})</summary>
          <ul class="mt-1 space-y-0.5">
            <li v-for="i in pack.skipped" :key="i.title">
              {{ i.title }}: <span class="text-muted">{{ i.reason }}</span>
            </li>
          </ul>
        </details>
      </template>
    </div>

    <div class="mt-5 flex justify-end">
      <UButton
        label="Save"
        :disabled="!dirty"
        :loading="saving"
        data-e2e="public-page-save"
        @click="save"
      />
    </div>
  </section>
</template>
