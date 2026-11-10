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

const copy = (p: PublicPage): PublicPage => ({ ...p, show: { ...p.show } })
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
