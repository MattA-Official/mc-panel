<script setup lang="ts">
const props = defineProps<{ jobId: number; steps: readonly string[] }>()
const emit = defineEmits<{ finished: [job: JobEvent] }>()

const job = ref<JobEvent | null>(null)
useTopic<JobEvent | null>(
  () => `job:${props.jobId}`,
  (data) => {
    if (!data) return
    job.value = data
    if (data.state === 'succeeded' || data.state === 'failed') emit('finished', data)
  },
)

const current = computed(() => (job.value?.step ? props.steps.indexOf(job.value.step) : -1))

function stateOf(i: number): 'done' | 'active' | 'failed' | 'waiting' {
  const j = job.value
  if (!j) return 'waiting'
  if (j.state === 'succeeded') return 'done'
  if (i < current.value) return 'done'
  if (i === current.value) return j.state === 'failed' ? 'failed' : 'active'
  return 'waiting'
}

const icons = {
  done: 'i-lucide-circle-check',
  active: 'i-lucide-loader-circle',
  failed: 'i-lucide-circle-x',
  waiting: 'i-lucide-circle',
}
</script>

<template>
  <div class="space-y-5">
    <UProgress
      :model-value="job?.progress ?? 0"
      :color="
        job?.state === 'failed' ? 'error' : job?.state === 'succeeded' ? 'success' : 'primary'
      "
    />
    <ol class="space-y-2">
      <li
        v-for="(step, i) in steps"
        :key="step"
        class="flex items-center gap-3 text-sm"
        :class="stateOf(i) === 'waiting' ? 'text-dimmed' : 'text-default'"
      >
        <UIcon
          :name="icons[stateOf(i)]"
          class="size-5 shrink-0"
          :class="{
            'animate-spin text-primary': stateOf(i) === 'active',
            'text-success': stateOf(i) === 'done',
            'text-error': stateOf(i) === 'failed',
          }"
        />
        <span class="whitespace-nowrap">{{ step }}</span>
        <span
          v-if="i === current && job?.message && job.state === 'running'"
          class="truncate font-mono text-xs text-muted"
          >{{ job.message }}</span
        >
      </li>
    </ol>
    <UAlert
      v-if="job?.state === 'failed'"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="That didn't work"
      :description="job.message ?? undefined"
    />
    <UAlert
      v-else-if="job?.state === 'succeeded'"
      color="success"
      variant="subtle"
      icon="i-lucide-party-popper"
      title="Curtain up"
      :description="job.message ?? undefined"
    />
  </div>
</template>
