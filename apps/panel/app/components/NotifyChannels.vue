<script setup lang="ts">
/** Where Flytower sends notifications: Discord channels, ntfy topics and JSON webhooks. */
import {
  CHANNEL_KINDS,
  DEFAULT_EVENTS,
  EVENT_GROUPS,
  EVENT_KINDS,
  type ChannelKind,
  type ChannelView,
  type EventGroup,
  type EventKind,
} from '#shared/notify'

const toast = useToast()
const withElevation = useElevation()
const { data: channels, refresh } = await useFetch<ChannelView[]>('/api/system/notify', {
  default: () => [],
})
const { data: servers } = await useFetch<Server[]>('/api/servers', { default: () => [] })
const serverItems = computed(() =>
  servers.value.map((s) => ({ label: s.displayName, value: s.name })),
)
const serverLabel = (name: string) =>
  servers.value.find((s) => s.name === name)?.displayName ?? name

const kindItems = (Object.keys(CHANNEL_KINDS) as ChannelKind[]).map((k) => ({
  label: CHANNEL_KINDS[k],
  value: k,
}))
const groups = (Object.keys(EVENT_GROUPS) as EventGroup[]).map((g) => ({
  id: g,
  label: EVENT_GROUPS[g],
  events: (Object.keys(EVENT_KINDS) as EventKind[]).filter((k) => EVENT_KINDS[k].group === g),
}))

const HELP: Record<ChannelKind, { url: string; placeholder: string; secret?: string }> = {
  discord: {
    url: 'In Discord: the channel’s settings, Integrations, Webhooks, New Webhook, Copy Webhook URL.',
    placeholder: 'https://discord.com/api/webhooks/…',
  },
  ntfy: {
    url: 'The topic’s address. Pick a long, hard-to-guess topic name on public ntfy.sh, since anyone who knows it can read it.',
    placeholder: 'https://ntfy.sh/your-long-topic-name',
    secret: 'Access token, if your ntfy server needs one',
  },
  webhook: {
    url: 'Flytower POSTs each event as JSON to this address.',
    placeholder: 'https://example.com/flytower-hook',
    secret: 'Signing secret, for the X-Flytower-Signature header',
  },
}

// ------------------------------------------------------------------ the form

const open = ref(false)
const editing = ref<ChannelView | null>(null)
const blank = () => ({
  name: '',
  kind: 'discord' as ChannelKind,
  url: '',
  secret: '',
  /** Editing: remove the saved secret. */
  clearSecret: false,
  events: [...DEFAULT_EVENTS] as EventKind[],
  servers: [] as string[],
  enabled: true,
})
const form = reactive(blank())
const testing = ref(false)
const saving = ref(false)
const result = ref<{ ok: boolean; message: string } | null>(null)

function add() {
  editing.value = null
  Object.assign(form, blank())
  result.value = null
  open.value = true
}

function edit(c: ChannelView) {
  editing.value = c
  Object.assign(form, {
    ...blank(),
    name: c.name,
    kind: c.kind,
    events: [...c.events],
    servers: [...c.servers],
    enabled: c.enabled,
  })
  result.value = null
  open.value = true
}

function toggle(kind: EventKind, on: boolean | 'indeterminate') {
  form.events =
    on === true ? [...new Set([...form.events, kind])] : form.events.filter((e) => e !== kind)
}

function generateSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  form.secret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  form.clearSecret = false
}

/** The body for the API: blanks mean "keep what's saved" when editing. */
function body() {
  const out: Record<string, unknown> = {
    name: form.name,
    kind: form.kind,
    events: form.events,
    servers: form.servers,
    enabled: form.enabled,
  }
  if (form.url.trim()) out.url = form.url.trim()
  if (form.kind !== 'discord') {
    if (form.secret.trim()) out.secret = form.secret.trim()
    else if (form.clearSecret || !editing.value) out.secret = null
  } else {
    out.secret = null
  }
  return out
}

async function test() {
  testing.value = true
  result.value = null
  try {
    await $fetch<unknown>('/api/system/notify/test' as string, {
      method: 'POST',
      body: { ...body(), id: editing.value?.id },
    })
    result.value = { ok: true, message: 'Sent. Check it arrived.' }
  } catch (err) {
    result.value = { ok: false, message: errorMessage(err) }
  } finally {
    testing.value = false
  }
}

async function save() {
  saving.value = true
  const c = editing.value
  try {
    await withElevation(() =>
      c
        ? $fetch<unknown>(`/api/system/notify/${c.id}` as string, { method: 'PUT', body: body() })
        : $fetch<unknown>('/api/system/notify' as string, { method: 'POST', body: body() }),
    )
    toast.add({ title: c ? `Saved ${form.name}` : `Added ${form.name}`, color: 'success' })
    open.value = false
    refresh()
  } catch (err) {
    result.value = { ok: false, message: errorMessage(err) }
  } finally {
    saving.value = false
  }
}

// ------------------------------------------------------------------ the list

const sendingTo = ref<number | null>(null)
async function sendTest(c: ChannelView) {
  sendingTo.value = c.id
  try {
    await $fetch<unknown>('/api/system/notify/test' as string, {
      method: 'POST',
      body: { id: c.id, name: c.name, kind: c.kind, events: c.events, servers: c.servers },
    })
    toast.add({ title: `Sent a test to ${c.name}`, color: 'success' })
  } catch (err) {
    toast.add({ title: "The test didn't arrive", description: errorMessage(err), color: 'error' })
  } finally {
    sendingTo.value = null
  }
}

const removing = ref<ChannelView | null>(null)
async function remove() {
  const c = removing.value
  if (!c) return
  try {
    await withElevation(() =>
      $fetch<unknown>(`/api/system/notify/${c.id}` as string, { method: 'DELETE' }),
    )
    toast.add({ title: `Removed ${c.name}`, color: 'success' })
    removing.value = null
    refresh()
  } catch (err) {
    toast.add({ title: "Couldn't remove it", description: errorMessage(err), color: 'error' })
  }
}

const when = (iso: string) => formatDateTime(iso)

function summary(c: ChannelView) {
  const n = c.events.length
  const events = n === 1 ? EVENT_KINDS[c.events[0]!].label : `${n} kinds of event`
  const where = c.servers.length ? c.servers.map(serverLabel).join(', ') : 'every server'
  return `${events}, ${where}`
}
</script>

<template>
  <UCard class="max-w-3xl" data-e2e="notify-channels">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 class="font-medium">Notifications</h2>
          <p class="mt-1 text-sm text-muted">
            Hear about failed backups, a filling disk and new versions without watching the panel.
            Send them to Discord, to your phone with ntfy, or anywhere as JSON.
          </p>
        </div>
        <UButton icon="i-lucide-plus" label="Add channel" @click="add" />
      </div>
    </template>

    <ul v-if="channels?.length" class="divide-y divide-default">
      <li v-for="c in channels" :key="c.id" class="flex items-center justify-between gap-4 py-2">
        <div class="min-w-0">
          <p class="flex flex-wrap items-center gap-2 font-medium">
            {{ c.name }}
            <UBadge :label="CHANNEL_KINDS[c.kind]" variant="subtle" color="neutral" size="sm" />
            <UBadge v-if="!c.enabled" label="Paused" variant="subtle" color="warning" size="sm" />
          </p>
          <p class="truncate font-mono text-xs text-muted">{{ c.target }}</p>
          <p class="text-xs text-muted">{{ summary(c) }}</p>
          <p v-if="c.lastError" class="text-xs text-error">
            Last delivery failed{{ c.lastErrorAt ? ` (${when(c.lastErrorAt)})` : '' }}:
            {{ c.lastError }}
          </p>
          <p v-else-if="c.lastSentAt" class="text-xs text-muted">
            Last sent {{ when(c.lastSentAt) }}
          </p>
        </div>
        <div class="flex shrink-0 gap-1">
          <UButton
            icon="i-lucide-send"
            color="neutral"
            variant="ghost"
            :loading="sendingTo === c.id"
            :aria-label="`Send a test to ${c.name}`"
            @click="sendTest(c)"
          />
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="ghost"
            :aria-label="`Edit ${c.name}`"
            @click="edit(c)"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="neutral"
            variant="ghost"
            :aria-label="`Remove ${c.name}`"
            @click="removing = c"
          />
        </div>
      </li>
    </ul>
    <p v-else class="text-sm text-muted">
      None yet. A Discord webhook is the quickest start: it takes a minute to make one.
    </p>

    <USlideover
      v-model:open="open"
      :title="editing ? `Edit ${editing.name}` : 'Add a notification channel'"
      :ui="{ content: 'w-full sm:max-w-lg' }"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="save">
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Name" required>
              <UInput v-model="form.name" class="w-full" maxlength="40" placeholder="Admins" />
            </UFormField>
            <UFormField label="Send to">
              <USelect
                v-model="form.kind"
                :items="kindItems"
                class="w-full"
                data-e2e="notify-kind"
              />
            </UFormField>
          </div>
          <UFormField
            label="Address"
            :required="!editing"
            :description="HELP[form.kind].url"
            :help="editing ? 'Leave blank to keep the saved address.' : undefined"
          >
            <UInput
              v-model="form.url"
              class="w-full font-mono"
              :placeholder="editing ? editing.target : HELP[form.kind].placeholder"
              autocomplete="off"
            />
          </UFormField>
          <UFormField
            v-if="HELP[form.kind].secret"
            :label="HELP[form.kind].secret"
            :help="editing?.hasSecret ? 'Leave blank to keep the saved one.' : 'Stored encrypted.'"
          >
            <div class="flex gap-2">
              <UInput
                v-model="form.secret"
                :type="form.kind === 'webhook' ? 'text' : 'password'"
                class="w-full font-mono"
                autocomplete="off"
              />
              <UButton
                v-if="form.kind === 'webhook'"
                label="Generate"
                color="neutral"
                variant="outline"
                @click="generateSecret"
              />
            </div>
            <UCheckbox
              v-if="editing?.hasSecret && !form.secret"
              v-model="form.clearSecret"
              class="mt-2"
              label="Remove the saved one"
            />
          </UFormField>

          <fieldset v-for="g in groups" :key="g.id" class="space-y-1.5">
            <legend class="mb-1 text-sm font-medium">{{ g.label }}</legend>
            <UCheckbox
              v-for="k in g.events"
              :key="k"
              :model-value="form.events.includes(k)"
              :label="EVENT_KINDS[k].label"
              @update:model-value="(v: boolean | 'indeterminate') => toggle(k, v)"
            />
          </fieldset>

          <UFormField
            label="Servers"
            description="Leave empty for every server, including new ones."
          >
            <USelectMenu
              v-model="form.servers"
              :items="serverItems"
              value-key="value"
              multiple
              placeholder="Every server"
              class="w-full"
            />
          </UFormField>
          <USwitch v-model="form.enabled" label="Send notifications" />

          <UAlert
            v-if="result"
            :color="result.ok ? 'success' : 'error'"
            variant="subtle"
            :icon="result.ok ? 'i-lucide-check' : 'i-lucide-circle-alert'"
            :title="result.message"
          />
          <p class="text-xs text-muted">Saving asks for your passkey.</p>
          <div class="flex justify-end gap-2">
            <UButton
              label="Send test"
              color="neutral"
              variant="outline"
              icon="i-lucide-send"
              :loading="testing"
              @click="test"
            />
            <UButton
              type="submit"
              :label="editing ? 'Save' : 'Add'"
              :loading="saving"
              data-e2e="notify-save"
            />
          </div>
        </form>
      </template>
    </USlideover>

    <UModal
      :open="!!removing"
      :title="`Remove ${removing?.name}?`"
      @update:open="(o: boolean) => !o && (removing = null)"
    >
      <template #body>
        <p class="text-sm">
          Flytower stops sending to it. You're asked for your passkey. The Discord webhook or ntfy
          topic itself isn't touched.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="removing = null" />
          <UButton label="Remove" color="error" @click="remove" />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
