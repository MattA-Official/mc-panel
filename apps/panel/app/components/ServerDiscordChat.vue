<script setup lang="ts">
/** Game chat to a Discord channel: the channel's webhook, and what gets posted. */
import type { RelayView } from '#shared/discord-relay'

const { server, refresh } = useServerContext()
const toast = useToast()
const withElevation = useElevation()

const relay = computed(() => server.value?.discordRelay)
const url = ref('')
const chat = ref(true)
const joins = ref(true)
const deaths = ref(true)
const advancements = ref(true)
const fromDiscord = ref(false)
watch(
  relay,
  (r) => {
    if (!r) return
    chat.value = r.chat
    joins.value = r.joins
    deaths.value = r.deaths
    advancements.value = r.advancements
    fromDiscord.value = r.fromDiscord
  },
  { immediate: true },
)

const dirty = computed(
  () =>
    !!url.value.trim() ||
    (!!relay.value?.configured &&
      (chat.value !== relay.value.chat ||
        joins.value !== relay.value.joins ||
        deaths.value !== relay.value.deaths ||
        advancements.value !== relay.value.advancements ||
        fromDiscord.value !== relay.value.fromDiscord)),
)

const saving = ref(false)
const testing = ref(false)
const result = ref<{ ok: boolean; message: string } | null>(null)
const base = computed(() => `/api/servers/${server.value?.name}/discord-relay`)

async function save() {
  if (!server.value) return
  saving.value = true
  result.value = null
  const first = !relay.value?.configured
  try {
    await withElevation(() =>
      $fetch<RelayView>(base.value as string, {
        method: 'PUT',
        body: {
          ...(url.value.trim() && { url: url.value.trim() }),
          chat: chat.value,
          joins: joins.value,
          deaths: deaths.value,
          advancements: advancements.value,
          fromDiscord: fromDiscord.value,
        },
      }),
    )
    url.value = ''
    await refresh()
    toast.add({
      title: first ? 'Chat will be posted to Discord' : 'Discord chat saved',
      color: 'success',
    })
  } catch (err) {
    toast.add({ title: "Couldn't save that", description: errorMessage(err), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function test() {
  testing.value = true
  result.value = null
  try {
    await $fetch(`${base.value}/test` as string, {
      method: 'POST',
      body: url.value.trim() ? { url: url.value.trim() } : {},
    })
    result.value = { ok: true, message: 'Sent. Check it arrived in the channel.' }
  } catch (err) {
    result.value = { ok: false, message: errorMessage(err) }
  } finally {
    testing.value = false
  }
}

const removing = ref(false)
async function remove() {
  if (!server.value) return
  removing.value = true
  try {
    await $fetch(base.value as string, { method: 'DELETE' })
    url.value = ''
    result.value = null
    await refresh()
    toast.add({ title: 'Chat is no longer posted to Discord', color: 'success' })
  } catch (err) {
    toast.add({ title: "Couldn't turn it off", description: errorMessage(err), color: 'error' })
  } finally {
    removing.value = false
  }
}

/** Why chat from Discord won't show yet, when it's switched on here. */
const inboundNote = computed(() => {
  const r = relay.value
  if (!r || !fromDiscord.value) return null
  if (!r.inbound.enabled) {
    return 'Chat from Discord is off for the whole panel. Turn it on under System, Integrations, Discord app.'
  }
  if (r.inbound.state === 'stopped') {
    return `The connection to Discord has stopped: ${r.inbound.error ?? 'see System, Integrations.'}`
  }
  if (r.configured && r.fromDiscord && r.inbound.botInServer === false) {
    return 'The bot isn’t in this channel’s Discord server yet. Add it from System, Integrations, Discord app.'
  }
  return null
})

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '')
</script>

<template>
  <section
    v-if="server && relay"
    class="rounded-lg border border-default p-5"
    data-e2e="discord-chat"
    data-doc="community.discord-chat"
  >
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 class="font-display text-lg tracking-wide uppercase">Discord chat</h2>
        <p class="mt-1 text-sm text-muted">
          Posts what players say in game to a Discord channel, under their name with their face as
          the picture, and when they join, leave, die or make an advancement. Nothing they type can
          ping anyone.
        </p>
      </div>
      <UBadge
        v-if="relay.configured"
        :color="relay.broken ? 'error' : 'success'"
        variant="subtle"
        :label="relay.broken ? 'Stopped' : 'On'"
      />
    </div>

    <UAlert
      v-if="relay.broken"
      class="mt-4"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Discord refused the chat, so it has stopped"
      :description="`${relay.lastError ?? ''} Paste the webhook again, or save to try the same one.`"
      data-e2e="discord-chat-broken"
    />
    <UAlert
      v-else-if="relay.lastError"
      class="mt-4"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="`Some chat didn't reach Discord (${when(relay.lastErrorAt)})`"
      :description="relay.lastError"
    />

    <UFormField
      class="mt-4"
      label="Channel webhook URL"
      data-doc="discord-chat.webhook"
      :ui="{ description: '[overflow-wrap:anywhere]' }"
      :description="
        relay.configured
          ? `Saved: ${relay.target}. Paste a new one to change it.`
          : 'In Discord: the channel’s settings, Integrations, Webhooks, New Webhook, Copy Webhook URL.'
      "
    >
      <UInput
        v-model="url"
        type="password"
        autocomplete="off"
        class="w-full"
        :placeholder="
          relay.configured ? 'Keep the saved webhook' : 'https://discord.com/api/webhooks/…'
        "
        data-e2e="discord-chat-url"
      />
    </UFormField>

    <div class="mt-4 space-y-3">
      <USwitch
        v-model="chat"
        label="Chat"
        description="What players say, and /me."
        data-e2e="discord-chat-chat"
      />
      <USwitch
        v-model="joins"
        label="Joins and leaves"
        description="A short line when someone joins or leaves."
        data-e2e="discord-chat-joins"
      />
      <USwitch
        v-model="deaths"
        label="Deaths"
        description="Minecraft's own death message, like “was slain by Zombie”."
        data-e2e="discord-chat-deaths"
      />
      <USwitch
        v-model="advancements"
        label="Advancements"
        description="When someone makes an advancement, reaches a goal or completes a challenge."
        data-e2e="discord-chat-advancements"
      />
      <USwitch
        v-model="fromDiscord"
        label="Chat from Discord"
        description="Shows messages from this channel in game, as [Discord] name: message. Plain text only."
        data-e2e="discord-chat-from-discord"
      />
      <UAlert
        v-if="inboundNote"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :description="inboundNote"
        data-e2e="discord-chat-inbound-note"
      />
    </div>

    <p
      v-if="result"
      class="mt-3 text-sm"
      :class="result.ok ? 'text-success' : 'text-error'"
      data-e2e="discord-chat-result"
    >
      {{ result.message }}
    </p>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <UButton
        :label="relay.configured ? 'Save' : 'Turn on'"
        :loading="saving"
        :disabled="
          (!relay.configured && !url.trim()) || (relay.configured && !dirty && !relay.broken)
        "
        data-e2e="discord-chat-save"
        @click="save"
      />
      <UButton
        label="Send a test"
        color="neutral"
        variant="outline"
        :loading="testing"
        :disabled="!relay.configured && !url.trim()"
        data-e2e="discord-chat-test"
        @click="test"
      />
      <UButton
        v-if="relay.configured"
        label="Turn off"
        color="neutral"
        variant="ghost"
        :loading="removing"
        data-e2e="discord-chat-remove"
        @click="remove"
      />
    </div>
  </section>
</template>
