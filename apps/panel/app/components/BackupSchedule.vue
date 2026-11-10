<script setup lang="ts">
export interface ScheduleSettings {
  cron: string | null
  tz: string
  keepLast: number
  keepDaily: number
  keepWeekly: number
  next: string | null
}
const props = defineProps<{ server: string; schedule: ScheduleSettings }>()
const emit = defineEmits<{ saved: [] }>()
const toast = useToast()

type Preset = 'off' | 'every6' | 'every12' | 'daily' | 'weekly' | 'custom'
const presets = [
  { label: 'Off', value: 'off' },
  { label: 'Every 6 hours', value: 'every6' },
  { label: 'Every 12 hours', value: 'every12' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Custom (cron)', value: 'custom' },
]
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
  (label, value) => ({ label, value }),
)
const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone

const form = reactive({
  preset: 'off' as Preset,
  time: '04:00',
  day: 0,
  custom: '',
  keepLast: 6,
  keepDaily: 7,
  keepWeekly: 4,
})
const pad = (n: string) => n.padStart(2, '0')

function load(s: ScheduleSettings) {
  Object.assign(form, { keepLast: s.keepLast, keepDaily: s.keepDaily, keepWeekly: s.keepWeekly })
  const c = s.cron ?? ''
  form.custom = c
  let m: RegExpMatchArray | null
  if (!c) form.preset = 'off'
  else if (c === '0 */6 * * *') form.preset = 'every6'
  else if (c === '0 */12 * * *') form.preset = 'every12'
  else if ((m = c.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/))) {
    form.preset = 'daily'
    form.time = `${pad(m[2]!)}:${pad(m[1]!)}`
  } else if ((m = c.match(/^(\d{1,2}) (\d{1,2}) \* \* ([0-6])$/))) {
    form.preset = 'weekly'
    form.time = `${pad(m[2]!)}:${pad(m[1]!)}`
    form.day = Number(m[3])
  } else form.preset = 'custom'
}
watch(() => props.schedule, load, { immediate: true })

const cron = computed(() => {
  const [h = '4', min = '0'] = form.time.split(':')
  const hm = `${Number(min)} ${Number(h)}`
  switch (form.preset) {
    case 'off':
      return null
    case 'every6':
      return '0 */6 * * *'
    case 'every12':
      return '0 */12 * * *'
    case 'daily':
      return `${hm} * * *`
    case 'weekly':
      return `${hm} * * ${form.day}`
    default:
      return form.custom.trim() || null
  }
})
// Keep the zone it was saved in unless the schedule changes; then use this browser's.
const tz = computed(() => (cron.value === props.schedule.cron ? props.schedule.tz : browserTz))

// What the schedule on screen would do, checked by the server as it's typed.
const preview = ref<{ next: string[]; error: string | null }>({ next: [], error: null })
let previewTimer: ReturnType<typeof setTimeout> | undefined
watch(
  [cron, tz],
  ([c, zone]) => {
    clearTimeout(previewTimer)
    if (!c) return (preview.value = { next: [], error: null })
    previewTimer = setTimeout(async () => {
      try {
        const r = await $fetch<{ next: string[] }>('/api/system/schedule-preview', {
          query: { cron: c, tz: zone },
        })
        preview.value = { next: r.next, error: null }
      } catch (err) {
        // "That schedule isn't valid: Invalid cron expression: expected 5 …" reads as one line.
        const msg = errorMessage(err).replace(/:\s*Invalid cron expression:\s*/i, ': ')
        preview.value = { next: [], error: msg }
      }
    }, 300)
  },
  { immediate: true },
)
const previewText = computed(() =>
  preview.value.next
    .map((at) =>
      new Date(at).toLocaleString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
    )
    .join(' · '),
)

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch(`/api/servers/${props.server}/backups/schedule` as string, {
      method: 'PUT',
      body: {
        cron: cron.value,
        tz: tz.value,
        keepLast: form.keepLast,
        keepDaily: form.keepDaily,
        keepWeekly: form.keepWeekly,
      },
    })
    toast.add({ title: 'Backup schedule saved', color: 'success' })
    emit('saved')
  } catch (err) {
    toast.add({
      title: "Couldn't save the schedule",
      description: errorMessage(err),
      color: 'error',
    })
  } finally {
    saving.value = false
  }
}

const nextText = computed(() =>
  props.schedule.next
    ? new Date(props.schedule.next).toLocaleString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null,
)
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-base font-semibold">Schedule</h2>
        <span v-if="nextText" class="text-sm text-muted">
          Next backup {{ nextText }}
          <span v-if="schedule.tz !== browserTz" class="text-dimmed">({{ schedule.tz }})</span>
        </span>
      </div>
    </template>
    <form class="space-y-5" @submit.prevent="save">
      <div class="space-y-2">
        <div class="flex flex-wrap items-start gap-3">
          <UFormField label="Back up">
            <USelect v-model="form.preset" :items="presets" class="w-44" />
          </UFormField>
          <UFormField v-if="form.preset === 'weekly'" label="On">
            <USelect v-model="form.day" :items="days" class="w-36" />
          </UFormField>
          <UFormField v-if="form.preset === 'daily' || form.preset === 'weekly'" label="At">
            <UInput v-model="form.time" type="time" class="w-32" />
          </UFormField>
          <UFormField
            v-if="form.preset === 'custom'"
            label="Cron expression"
            :error="!!preview.error"
            class="w-full sm:w-72"
          >
            <UInput
              v-model="form.custom"
              class="w-full font-mono"
              placeholder="30 3 * * 1-5"
              spellcheck="false"
              autocomplete="off"
              aria-describedby="cron-help"
            />
          </UFormField>
        </div>
        <p v-if="form.preset === 'custom'" id="cron-help" class="text-xs text-muted">
          Five parts: minute, hour, day of the month, month, day of the week. For example,
          <code class="font-mono">30 3 * * 1-5</code> is 03:30 on weekdays.
        </p>
        <p v-if="preview.error && form.custom.trim()" class="text-sm text-error">
          {{ preview.error }}
        </p>
        <p v-else-if="previewText && cron !== schedule.cron" class="text-sm text-muted">
          Would run next {{ previewText }}
        </p>
      </div>

      <div v-if="form.preset !== 'off'">
        <p class="mb-2 text-sm text-muted">
          Which scheduled backups to keep. Backups you make yourself are kept until you delete them.
          <HelpLink to="backups#how-many-are-kept" />
        </p>
        <div class="flex flex-wrap items-start gap-3">
          <UFormField label="Latest" help="backups">
            <UInputNumber v-model="form.keepLast" :min="0" :max="1000" class="w-28" />
          </UFormField>
          <UFormField label="One a day" help="for this many days">
            <UInputNumber v-model="form.keepDaily" :min="0" :max="366" class="w-28" />
          </UFormField>
          <UFormField label="One a week" help="for this many weeks">
            <UInputNumber v-model="form.keepWeekly" :min="0" :max="520" class="w-28" />
          </UFormField>
        </div>
      </div>

      <UButton
        type="submit"
        label="Save schedule"
        :loading="saving"
        :disabled="form.preset === 'custom' && (!form.custom.trim() || !!preview.error)"
      />
    </form>
  </UCard>
</template>
