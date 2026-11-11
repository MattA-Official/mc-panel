<script setup lang="ts">
/** Chat from Discord into the game: the panel-wide switch and how its connection stands. */
import type { DiscordState } from '#shared/discord'

type Connected = Extract<DiscordState, { connected: true }>

const props = defineProps<{ discord: Connected }>()
const emit = defineEmits<{ update: [state: DiscordState] }>()

const toast = useToast()
const withElevation = useElevation()
const busy = ref(false)

const chat = computed(() => props.discord.chat)

const badge = computed(() => {
  switch (chat.value.state) {
    case 'connected':
      return { color: 'success' as const, label: 'Connected' }
    case 'connecting':
      return { color: 'info' as const, label: 'Connecting' }
    case 'reconnecting':
      return { color: 'warning' as const, label: 'Reconnecting' }
    case 'stopped':
      return { color: 'error' as const, label: 'Stopped' }
    default:
      return { color: 'neutral' as const, label: 'Off' }
  }
})

async function set(enabled: boolean) {
  busy.value = true
  try {
    const call = () =>
      $fetch<DiscordState>('/api/system/discord/chat', { method: 'PUT', body: { enabled } })
    emit('update', enabled ? await withElevation(call) : await call())
    toast.add({
      title: enabled ? 'Connecting to Discord' : 'Chat from Discord is off',
      color: 'success',
    })
  } catch (err) {
    toast.add({ title: "Couldn't change that", description: errorMessage(err), color: 'error' })
  } finally {
    busy.value = false
  }
}

// The connection settles in a second or two; look again so the badge catches up.
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [chat.value.enabled, chat.value.state] as const,
  ([enabled, state]) => {
    clearTimeout(timer)
    if (!enabled || (state !== 'connecting' && state !== 'reconnecting')) return
    timer = setTimeout(async () => {
      const fresh = await $fetch<DiscordState>('/api/system/discord').catch(() => null)
      if (fresh) emit('update', fresh)
    }, 3000)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <section class="space-y-3 border-t border-default pt-4" data-e2e="discord-chat-in">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <h3 class="font-semibold">Chat from Discord</h3>
        <p class="mt-1 text-muted">
          Shows messages from a server's Discord chat channel in the game, as
          <code>[Discord] name: message</code>. Pick the servers under their
          <strong>Settings</strong>, <strong>Community</strong>, <strong>Discord chat</strong>.
        </p>
      </div>
      <UBadge
        class="shrink-0"
        variant="subtle"
        :color="badge.color"
        :label="badge.label"
        data-e2e="discord-chat-in-state"
      />
    </div>

    <UAlert
      v-if="chat.enabled && chat.state === 'stopped'"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Chat from Discord has stopped"
      :description="chat.error ?? undefined"
      data-e2e="discord-chat-in-error"
    >
      <template #actions>
        <UButton
          label="Connect again"
          size="sm"
          color="neutral"
          variant="outline"
          :loading="busy"
          @click="set(true)"
        />
      </template>
    </UAlert>
    <p v-else-if="chat.enabled && chat.state === 'reconnecting' && chat.error" class="text-muted">
      {{ chat.error }} Trying again.
    </p>

    <ol v-if="!chat.enabled" class="list-decimal space-y-1 pl-5 text-muted">
      <li>
        In the
        <ULink to="https://discord.com/developers/applications" target="_blank" class="underline"
          >Discord Developer Portal</ULink
        >, open the app's <strong>Bot</strong> tab and turn on
        <strong>Message Content Intent</strong> under Privileged Gateway Intents.
      </li>
      <li>
        Add the bot to your Discord server with the button below. It only asks to see channels.
      </li>
      <li>Turn this on. The panel keeps one connection to Discord open while it's on.</li>
    </ol>
    <p v-else-if="chat.state === 'connected'" class="text-muted">
      <template v-if="chat.servers.length"
        >Showing Discord chat in {{ chat.servers.join(', ') }}.</template
      >
      <template v-else>No server shows Discord chat yet.</template>
      The bot is in {{ chat.guildCount }} Discord server{{ chat.guildCount === 1 ? '' : 's' }}.
    </p>

    <div class="flex flex-wrap gap-2">
      <UButton
        v-if="!chat.enabled"
        label="Turn on"
        icon="i-lucide-message-circle"
        :loading="busy"
        data-e2e="discord-chat-in-on"
        @click="set(true)"
      />
      <UButton
        v-else
        label="Turn off"
        color="neutral"
        variant="outline"
        :loading="busy"
        data-e2e="discord-chat-in-off"
        @click="set(false)"
      />
      <UButton
        :to="discord.botInviteUrl"
        target="_blank"
        label="Add the bot to a Discord server"
        icon="i-lucide-external-link"
        color="neutral"
        variant="outline"
      />
    </div>
  </section>
</template>
