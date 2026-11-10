<script setup lang="ts">
import {
  describeCron,
  formatDuration,
  parseDuration,
  spokenDuration,
  toItem,
  type SchedulesView,
  type TaskKind,
  type TaskSpec,
  type TaskView,
} from '#shared/schedules'

const { server } = useServerContext()
const name = computed(() => server.value?.name ?? '')
const toast = useToast()

const { data, refresh } = await useFetch<SchedulesView>(
  () => `/api/servers/${name.value}/schedules`,
)
// Runs starting and finishing arrive here, so "Running…" and results show without reloading.
useTopic<SchedulesView>(
  () => (name.value ? `schedules:${name.value}` : null),
  (v) => (data.value = v),
)

const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
const zones = (() => {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return [browserTz, 'UTC']
  }
})()

const KINDS: Record<TaskKind, { label: string; icon: string }> = {
  restart: { label: 'Restart', icon: 'i-lucide-rotate-cw' },
  command: { label: 'Command', icon: 'i-lucide-terminal' },
  announce: { label: 'Announcement', icon: 'i-lucide-megaphone' },
}

function when(at: string | null) {
  if (!at) return null
  return new Date(at).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function title(t: TaskSpec) {
  if (t.kind === 'restart') return 'Restart'
  if (t.kind === 'command') return t.text ?? ''
  return `“${t.text ?? ''}”`
}

function detail(t: TaskSpec) {
  const parts = [describeCron(t.cron)]
  if (t.kind === 'restart') {
    parts.push(
      t.warn.length ? `warns ${t.warn.map(formatDuration).join(', ')} before` : 'no warnings',
    )
    if (t.skipWhenEmpty) parts.push('no countdown when empty')
  }
  return parts.join(' · ')
}

function resultColor(t: TaskView) {
  if (t.lastOk === true) return 'success' as const
  if (t.lastOk === false) return 'error' as const
  return 'neutral' as const
}

// Saving: the whole list goes up at once, as in the spec.
const saving = ref(false)
async function save(tasks: TaskSpec[], timezone = data.value?.timezone ?? 'UTC') {
  saving.value = true
  try {
    data.value = await $fetch<SchedulesView>(`/api/servers/${name.value}/schedules` as string, {
      method: 'PUT',
      body: { timezone, schedules: tasks.map(toItem) },
    })
    return true
  } catch (err) {
    toast.add({
      title: "Couldn't save the schedules",
      description: errorMessage(err),
      color: 'error',
    })
    return false
  } finally {
    saving.value = false
  }
}

const tasks = computed<TaskView[]>(() => data.value?.tasks ?? [])
const plain = (t: TaskSpec): TaskSpec => ({
  kind: t.kind,
  cron: t.cron,
  text: t.text,
  warn: t.warn,
  skipWhenEmpty: t.skipWhenEmpty,
})

// Time zone
const timezone = ref('UTC')
watch(
  () => data.value?.timezone,
  (z) => (timezone.value = z ?? 'UTC'),
  { immediate: true },
)
async function saveZone() {
  if (await save(tasks.value.map(plain), timezone.value)) {
    toast.add({ title: 'Time zone saved', color: 'success' })
  }
}

// Run now: a restart asks first, since it counts down and then restarts.
const confirming = ref<TaskView | null>(null)
function askRun(t: TaskView) {
  if (t.kind === 'restart') confirming.value = t
  else void runNow(t)
}
async function runNow(t: TaskView) {
  confirming.value = null
  try {
    data.value = await $fetch<SchedulesView>(
      `/api/servers/${name.value}/schedules/${t.id}/run` as string,
      { method: 'POST' },
    )
    toast.add({
      title: t.kind === 'restart' ? 'Restart started' : 'Running it now',
      description:
        t.kind === 'restart' && t.warn.length
          ? `Anyone online is warned first, and it restarts in ${spokenDuration(Math.max(...t.warn))}.`
          : undefined,
      color: 'success',
    })
  } catch (err) {
    toast.add({ title: "Couldn't run it", description: errorMessage(err), color: 'error' })
  }
}

async function cancel(t: TaskView) {
  try {
    data.value = await $fetch<SchedulesView>(
      `/api/servers/${name.value}/schedules/${t.id}/run` as string,
      { method: 'DELETE' },
    )
    toast.add({ title: 'Restart called off', color: 'success' })
  } catch (err) {
    toast.add({ title: "Couldn't call it off", description: errorMessage(err), color: 'error' })
  }
}

// Remove
const removing = ref<TaskView | null>(null)
async function remove() {
  const t = removing.value
  if (!t) return
  if (await save(tasks.value.filter((x) => x.id !== t.id).map(plain))) {
    toast.add({ title: 'Task removed', color: 'success' })
    removing.value = null
  }
}

// Add and edit
type Preset = 'daily' | 'weekly' | 'hourly' | 'minutes' | 'custom'
const presets = [
  { label: 'Every day at…', value: 'daily' },
  { label: 'Every week on…', value: 'weekly' },
  { label: 'Every hour', value: 'hourly' },
  { label: 'Every few minutes', value: 'minutes' },
  { label: 'Custom (cron)', value: 'custom' },
]
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
  (label, value) => ({ label, value }),
)
const kindItems = (Object.keys(KINDS) as TaskKind[]).map((k) => ({
  label: KINDS[k].label,
  value: k,
  icon: KINDS[k].icon,
}))

const editing = ref<{ index: number | null } | null>(null)
const form = reactive({
  kind: 'restart' as TaskKind,
  text: '',
  preset: 'daily' as Preset,
  time: '05:00',
  day: 0,
  minute: 0,
  every: 30,
  custom: '',
  warn: '15m, 5m, 1m, 10s',
  skipWhenEmpty: true,
})
const pad = (n: string) => n.padStart(2, '0')

function open(index: number | null) {
  const t = index === null ? null : tasks.value[index]
  Object.assign(form, {
    kind: t?.kind ?? 'restart',
    text: t?.text ?? '',
    preset: 'daily',
    time: '05:00',
    day: 0,
    minute: 0,
    every: 30,
    custom: t?.cron ?? '',
    warn: (t ? t.warn : [900, 300, 60, 10]).map(formatDuration).join(', '),
    skipWhenEmpty: t?.skipWhenEmpty ?? true,
  })
  const c = t?.cron ?? '0 5 * * *'
  let m: RegExpMatchArray | null
  if ((m = c.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/))) {
    form.preset = 'daily'
    form.time = `${pad(m[2]!)}:${pad(m[1]!)}`
  } else if ((m = c.match(/^(\d{1,2}) (\d{1,2}) \* \* ([0-6])$/))) {
    form.preset = 'weekly'
    form.time = `${pad(m[2]!)}:${pad(m[1]!)}`
    form.day = Number(m[3])
  } else if ((m = c.match(/^(\d{1,2}) \* \* \* \*$/))) {
    form.preset = 'hourly'
    form.minute = Number(m[1])
  } else if ((m = c.match(/^\*\/(\d{1,2}) \* \* \* \*$/))) {
    form.preset = 'minutes'
    form.every = Number(m[1])
  } else form.preset = 'custom'
  editing.value = { index }
}

const cron = computed(() => {
  const [h = '5', min = '0'] = form.time.split(':')
  const hm = `${Number(min)} ${Number(h)}`
  switch (form.preset) {
    case 'daily':
      return `${hm} * * *`
    case 'weekly':
      return `${hm} * * ${form.day}`
    case 'hourly':
      return `${form.minute} * * * *`
    case 'minutes':
      return `*/${form.every} * * * *`
    default:
      return form.custom.trim()
  }
})

const warnings = computed(() => {
  const parts = form.warn
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const secs = parts.map(parseDuration)
  return secs.every((s) => s !== null) ? [...new Set(secs as number[])].sort((a, b) => b - a) : null
})

// What the cron on screen would do, checked by the server as it's typed.
const preview = ref<{ next: string[]; error: string | null }>({ next: [], error: null })
let previewTimer: ReturnType<typeof setTimeout> | undefined
watch(
  [cron, timezone, editing],
  ([c, zone, e]) => {
    clearTimeout(previewTimer)
    if (!e || !c) return (preview.value = { next: [], error: null })
    previewTimer = setTimeout(async () => {
      try {
        const r = await $fetch<{ next: string[] }>('/api/system/schedule-preview', {
          query: { cron: c, tz: data.value?.timezone ?? zone },
        })
        preview.value = { next: r.next, error: null }
      } catch (err) {
        const msg = errorMessage(err).replace(/:\s*Invalid cron expression:\s*/i, ': ')
        preview.value = { next: [], error: msg }
      }
    }, 300)
  },
  { immediate: true },
)

const formError = computed(() => {
  if (!cron.value) return 'Choose when it runs.'
  if (preview.value.error) return preview.value.error
  if (form.kind !== 'restart' && !form.text.trim()) {
    return form.kind === 'command' ? 'Type the command.' : 'Type the message.'
  }
  if (form.kind === 'command' && form.text.trim().startsWith('/')) {
    return 'Leave out the slash at the start.'
  }
  if (form.kind === 'restart' && !warnings.value) {
    return 'Write warnings like 15m, 5m, 1m, 10s.'
  }
  return null
})

async function submit() {
  if (!editing.value || formError.value) return
  const task: TaskSpec =
    form.kind === 'restart'
      ? {
          kind: 'restart',
          cron: cron.value,
          text: null,
          warn: warnings.value ?? [],
          skipWhenEmpty: form.skipWhenEmpty,
        }
      : {
          kind: form.kind,
          cron: cron.value,
          text: form.text.trim(),
          warn: [],
          skipWhenEmpty: false,
        }
  const list = tasks.value.map(plain)
  const { index } = editing.value
  if (index === null) list.push(task)
  else list[index] = task
  if (await save(list)) {
    toast.add({ title: index === null ? 'Task added' : 'Task saved', color: 'success' })
    editing.value = null
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted">
        Restarts, commands and announcements that run by themselves. They're in the server's YAML as
        <code class="font-mono">schedules</code>.
      </p>
      <UButton label="Add task" icon="i-lucide-plus" @click="open(null)" />
    </div>

    <div class="overflow-hidden rounded-lg border border-default">
      <ul class="divide-y divide-default">
        <li
          v-for="(t, i) in tasks"
          :key="t.id"
          class="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
        >
          <div class="flex min-w-0 flex-1 items-start gap-3">
            <UIcon :name="KINDS[t.kind].icon" class="mt-0.5 size-5 shrink-0 text-muted" />
            <div class="min-w-0 space-y-0.5">
              <p
                class="truncate font-medium"
                :class="{ 'font-mono text-sm': t.kind === 'command' }"
              >
                {{ title(t) }}
              </p>
              <p class="text-sm text-muted">{{ detail(t) }}</p>
              <p class="text-xs text-dimmed">
                <template v-if="t.running">
                  <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin align-middle" />
                  Running now
                </template>
                <template v-else-if="t.nextRunAt">Next {{ when(t.nextRunAt) }}</template>
                <template v-else>Never runs: check the cron expression</template>
              </p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2 sm:justify-end">
            <UTooltip
              v-if="t.lastRunAt"
              :text="t.lastReply ? `Reply: ${t.lastReply}` : `Last run ${when(t.lastRunAt)}`"
            >
              <UBadge
                :color="resultColor(t)"
                variant="subtle"
                size="sm"
                class="max-w-72 truncate"
                :label="`${when(t.lastRunAt)}: ${t.lastResult}`"
              />
            </UTooltip>
            <UButton
              v-if="t.running && t.kind === 'restart'"
              label="Call off"
              icon="i-lucide-circle-stop"
              size="xs"
              color="warning"
              variant="outline"
              @click="cancel(t)"
            />
            <UButton
              v-else
              label="Run now"
              icon="i-lucide-play"
              size="xs"
              color="neutral"
              variant="outline"
              :disabled="t.running"
              @click="askRun(t)"
            />
            <UButton
              icon="i-lucide-pencil"
              size="xs"
              color="neutral"
              variant="ghost"
              :aria-label="`Edit ${title(t)}`"
              @click="open(i)"
            />
            <UButton
              icon="i-lucide-trash-2"
              size="xs"
              color="neutral"
              variant="ghost"
              :aria-label="`Remove ${title(t)}`"
              @click="removing = t"
            />
          </div>
        </li>
        <li v-if="!tasks.length" class="px-4 py-8 text-center text-sm text-muted">
          Nothing scheduled. Add a daily restart, a regular command or an announcement.
        </li>
      </ul>
    </div>

    <UCard>
      <template #header>
        <h2 class="text-base font-semibold">Time zone</h2>
      </template>
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="saveZone">
        <UFormField label="Schedules run in" class="w-full sm:w-72">
          <USelectMenu v-model="timezone" :items="zones" class="w-full" />
        </UFormField>
        <UButton
          type="submit"
          label="Save"
          :loading="saving"
          :disabled="timezone === data?.timezone"
        />
        <UButton
          v-if="timezone !== browserTz"
          label="Use mine"
          color="neutral"
          variant="ghost"
          @click="timezone = browserTz"
        />
      </form>
      <p class="mt-3 text-sm text-muted">
        Backups keep their own time zone, set on the Backups tab.
      </p>
    </UCard>

    <UModal
      :open="editing !== null"
      :title="editing?.index === null ? 'Add a task' : 'Edit task'"
      @update:open="(v) => !v && (editing = null)"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="submit">
          <UFormField label="What">
            <USelect v-model="form.kind" :items="kindItems" class="w-48" />
          </UFormField>
          <UFormField v-if="form.kind === 'command'" label="Command" help="Without the slash.">
            <UInput
              v-model="form.text"
              class="w-full font-mono"
              placeholder="save-all"
              spellcheck="false"
              autocomplete="off"
            />
          </UFormField>
          <UFormField
            v-if="form.kind === 'announce'"
            label="Message"
            help="Shown in everyone's chat, in gold."
          >
            <UInput v-model="form.text" class="w-full" maxlength="256" />
          </UFormField>

          <div class="flex flex-wrap items-start gap-3">
            <UFormField label="When">
              <USelect v-model="form.preset" :items="presets" class="w-48" />
            </UFormField>
            <UFormField v-if="form.preset === 'weekly'" label="On">
              <USelect v-model="form.day" :items="days" class="w-36" />
            </UFormField>
            <UFormField v-if="form.preset === 'daily' || form.preset === 'weekly'" label="At">
              <UInput v-model="form.time" type="time" class="w-32" />
            </UFormField>
            <UFormField v-if="form.preset === 'hourly'" label="Minutes past">
              <UInputNumber v-model="form.minute" :min="0" :max="59" class="w-28" />
            </UFormField>
            <UFormField v-if="form.preset === 'minutes'" label="Every (minutes)">
              <UInputNumber v-model="form.every" :min="1" :max="59" class="w-28" />
            </UFormField>
            <UFormField v-if="form.preset === 'custom'" label="Cron expression" class="w-full">
              <UInput
                v-model="form.custom"
                class="w-full font-mono"
                placeholder="0 5 * * 1-5"
                spellcheck="false"
                autocomplete="off"
              />
            </UFormField>
          </div>
          <p v-if="preview.next.length && !preview.error" class="text-sm text-muted">
            Next {{ preview.next.map((n) => when(n)).join(' · ') }}
            <span v-if="data && data.timezone !== browserTz" class="text-dimmed"
              >({{ data.timezone }})</span
            >
          </p>

          <template v-if="form.kind === 'restart'">
            <UFormField
              label="Warn players"
              help="How long before, like 15m, 5m, 1m, 10s. The last 10 seconds also show on screen. Leave it empty for no warnings."
            >
              <UInput v-model="form.warn" class="w-full font-mono" />
            </UFormField>
            <UCheckbox
              v-model="form.skipWhenEmpty"
              label="Restart straight away when nobody is online"
              description="Skips the countdown, so the restart can happen up to the first warning early."
            />
          </template>

          <p
            v-if="formError && (form.text || form.custom || form.kind === 'restart')"
            class="text-sm text-error"
          >
            {{ formError }}
          </p>
        </form>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="editing = null" />
          <UButton label="Save" :loading="saving" :disabled="!!formError" @click="submit" />
        </div>
      </template>
    </UModal>

    <UModal
      :open="confirming !== null"
      title="Restart now?"
      @update:open="(v) => !v && (confirming = null)"
    >
      <template #body>
        <p v-if="confirming" class="text-sm">
          <template v-if="confirming.warn.length">
            Anyone online is warned in chat, and the server restarts in
            {{ spokenDuration(Math.max(...confirming.warn)) }}. You can call it off until then.
            <template v-if="confirming.skipWhenEmpty">
              If nobody is online, it restarts straight away.</template
            >
          </template>
          <template v-else>The server restarts straight away, without warnings.</template>
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="confirming = null" />
          <UButton
            label="Start the countdown"
            icon="i-lucide-rotate-cw"
            @click="confirming && runNow(confirming)"
          />
        </div>
      </template>
    </UModal>

    <UModal
      :open="removing !== null"
      title="Remove this task?"
      :description="removing ? `${title(removing)}, ${describeCron(removing.cron)}.` : ''"
      @update:open="(v) => !v && (removing = null)"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="removing = null" />
          <UButton label="Remove" color="error" icon="i-lucide-trash-2" @click="remove" />
        </div>
      </template>
    </UModal>
  </div>
</template>
