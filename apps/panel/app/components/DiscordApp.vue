<script setup lang="ts">
/** Connects a Discord app, so people can use Flytower's slash commands in a Discord server. */
import type { DiscordState } from '#shared/discord'

const toast = useToast()
const withElevation = useElevation()
const { data: discord, error } = await useFetch<DiscordState>('/api/system/discord')

const token = ref('')
const busy = ref<'connect' | 'test' | 'endpoint' | 'commands' | 'disconnect' | null>(null)
const confirming = ref(false)

async function run(
  kind: NonNullable<typeof busy.value>,
  call: () => Promise<DiscordState>,
  done: (s: DiscordState) => string,
  failed: string,
) {
  busy.value = kind
  try {
    discord.value = await call()
    toast.add({ title: done(discord.value), color: 'success' })
    return true
  } catch (err) {
    toast.add({ title: failed, description: errorMessage(err), color: 'error' })
    return false
  } finally {
    busy.value = null
  }
}

async function connect() {
  const ok = await run(
    'connect',
    () =>
      withElevation(() =>
        $fetch<DiscordState>('/api/system/discord', {
          method: 'POST',
          body: { token: token.value },
        }),
      ),
    (s) => (s.connected ? `Connected ${s.name}` : 'Connected'),
    "Couldn't connect the app",
  )
  if (ok) token.value = ''
}
const test = () =>
  run(
    'test',
    () => $fetch<DiscordState>('/api/system/discord/test', { method: 'POST' }),
    () => 'Discord accepted the token',
    'The connection failed',
  )
const retryEndpoint = () =>
  run(
    'endpoint',
    () => $fetch<DiscordState>('/api/system/discord/endpoint', { method: 'POST' }),
    (s) => (s.connected && s.endpointSet ? 'Discord accepted the endpoint' : 'Tried again'),
    "Couldn't set the endpoint",
  )
const resendCommands = () =>
  run(
    'commands',
    () => $fetch<DiscordState>('/api/system/discord/commands', { method: 'POST' }),
    (s) => (s.connected && !s.commandsError ? 'Discord took the commands' : 'Tried again'),
    "Couldn't send the commands",
  )
async function disconnect() {
  const ok = await run(
    'disconnect',
    () =>
      withElevation(() =>
        $fetch<DiscordState & { cleanedUp: boolean }>('/api/system/discord', {
          method: 'DELETE',
        }),
      ),
    () => 'Disconnected',
    "Couldn't disconnect",
  )
  if (ok) confirming.value = false
}

const { copied, copy } = useCopyButton()
async function copyEndpoint() {
  if (discord.value?.endpointUrl) await copy(discord.value.endpointUrl, 'Endpoint URL')
}
</script>

<template>
  <UCard data-doc="system.discord">
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <h2 class="flex items-center gap-2 font-semibold">
          <UIcon name="i-lucide-message-square-code" class="size-5" />
          Discord app
        </h2>
        <UBadge
          v-if="discord"
          variant="subtle"
          :color="!discord.connected ? 'neutral' : discord.endpointSet ? 'success' : 'warning'"
          :label="
            !discord.connected
              ? 'Not connected'
              : discord.endpointSet
                ? 'Connected'
                : 'Endpoint not set'
          "
          data-e2e="discord-state"
        />
      </div>
    </template>

    <UAlert v-if="error" color="error" variant="subtle" :title="errorMessage(error)" />

    <div v-else-if="discord && !discord.connected" class="space-y-4 text-sm">
      <p>
        Connect a Discord app and people in your Discord server can use slash commands like
        <code>/status</code> and <code>/players</code>. It's separate from Discord notifications,
        which only need a webhook.
      </p>
      <ol class="list-decimal space-y-1 pl-5 text-muted">
        <li>
          Open the
          <ULink to="https://discord.com/developers/applications" target="_blank" class="underline"
            >Discord Developer Portal</ULink
          >
          and make a New Application (the name and icon are what people see).
        </li>
        <li>On its Bot tab, press Reset Token and copy the token.</li>
        <li>Paste it here. Flytower sets the rest up on Discord for you.</li>
      </ol>
      <UAlert
        v-if="discord && !discord.endpointUrl"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="This panel has no domain"
        description="Discord only sends commands to an https address, so give the panel a domain first."
      />
      <form class="flex flex-wrap items-end gap-2" @submit.prevent="connect">
        <UFormField label="Bot token" class="min-w-0 flex-1" data-doc="discord.token">
          <UInput
            v-model="token"
            type="password"
            autocomplete="off"
            placeholder="Paste the bot token"
            class="w-full"
            data-e2e="discord-token"
          />
        </UFormField>
        <UButton
          type="submit"
          label="Connect"
          icon="i-lucide-plug"
          :disabled="!token.trim()"
          :loading="busy === 'connect'"
        />
      </form>
      <p class="text-xs text-muted">
        The token is stored encrypted and never shown again. You're asked for your passkey.
      </p>
    </div>

    <div v-else-if="discord && discord.connected" class="space-y-4 text-sm">
      <dl class="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
        <dt class="text-muted">App</dt>
        <dd class="font-medium" data-e2e="discord-app-name">{{ discord.name }}</dd>
        <dt class="text-muted">Application ID</dt>
        <dd class="font-mono break-all">{{ discord.applicationId }}</dd>
        <dt class="text-muted">Interactions endpoint</dt>
        <dd class="flex min-w-0 items-center gap-1">
          <span class="font-mono break-all">{{ discord.endpointUrl ?? 'None (no domain)' }}</span>
          <UButton
            v-if="discord.endpointUrl"
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            :aria-label="copied ? 'Copied' : 'Copy endpoint URL'"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="copyEndpoint"
          />
        </dd>
        <dt class="text-muted">Commands</dt>
        <dd class="flex flex-wrap gap-1">
          <UBadge
            v-for="c in discord.commands"
            :key="c"
            :label="`/${c}`"
            color="neutral"
            variant="soft"
            class="font-mono"
          />
        </dd>
        <dt class="text-muted">Connected</dt>
        <dd>{{ formatDateTime(discord.connectedAt) }}</dd>
      </dl>

      <UAlert
        v-if="!discord.endpointSet"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Discord didn't take the endpoint"
      >
        <template #description>
          <p>{{ discord.endpointError }}</p>
          <p class="mt-1">
            Discord has to reach this panel from the internet. Fix that and try again, or paste the
            endpoint above into Interactions Endpoint URL on the app's General Information page.
          </p>
        </template>
      </UAlert>

      <UAlert
        v-if="discord.commandsError"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Discord didn't take the commands"
        :description="discord.commandsError"
      >
        <template #actions>
          <UButton
            label="Send them again"
            size="sm"
            color="neutral"
            variant="outline"
            :loading="busy === 'commands'"
            @click="resendCommands"
          />
        </template>
      </UAlert>

      <div class="flex flex-wrap gap-2">
        <UButton
          :to="discord.inviteUrl"
          target="_blank"
          label="Add to a Discord server"
          icon="i-lucide-external-link"
        />
        <UButton
          v-if="!discord.endpointSet"
          label="Try the endpoint again"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="busy === 'endpoint'"
          @click="retryEndpoint"
        />
        <UButton
          label="Test connection"
          icon="i-lucide-activity"
          color="neutral"
          variant="outline"
          :loading="busy === 'test'"
          @click="test"
        />
        <UButton
          label="Disconnect"
          color="error"
          variant="ghost"
          :disabled="!!busy"
          @click="confirming = true"
        />
      </div>

      <DiscordRoles />

      <DiscordChatIn :discord="discord" @update="(s) => (discord = s)" />
    </div>

    <UModal
      :open="confirming"
      :title="`Disconnect ${discord?.connected ? discord.name : 'the app'}?`"
      @update:open="(o: boolean) => !o && (confirming = false)"
    >
      <template #body>
        <p class="text-sm">
          Flytower takes the app's commands down and forgets its token. The app itself stays in the
          Developer Portal, and in any Discord server it was added to. You're asked for your
          passkey.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="confirming = false" />
          <UButton
            label="Disconnect"
            color="error"
            :loading="busy === 'disconnect'"
            @click="disconnect"
          />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
