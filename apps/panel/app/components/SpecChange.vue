<script setup lang="ts">
import type { PlanView } from '~/components/SpecPlan.vue'

/**
 * Proposes a spec change: asks for a plan, shows it, and applies it with live progress.
 * Call `propose(spec)` with the whole new spec, or `propose(null, { upgrade })`.
 */
const props = defineProps<{ server: string }>()
const emit = defineEmits<{ applied: [] }>()
const toast = useToast()

const open = ref(false)
const title = ref('')
const plan = ref<PlanView | null>(null)
const loading = ref(false)
const applying = ref(false)
const job = ref<number | null>(null)
const finished = ref<JobEvent | null>(null)

async function propose(
  spec: unknown,
  opts: { title: string; upgrade?: true | string[] },
): Promise<void> {
  title.value = opts.title
  plan.value = null
  job.value = null
  finished.value = null
  open.value = true
  loading.value = true
  try {
    const current =
      spec ?? (await $fetch<{ spec: unknown }>(`/api/servers/${props.server}/spec` as string)).spec
    const r = await $fetch<{
      ok: boolean
      plan?: PlanView
      issues?: { path: string; message: string }[]
    }>(`/api/servers/${props.server}/plan` as string, {
      method: 'POST',
      body: { spec: current, ...(opts.upgrade ? { upgrade: opts.upgrade } : {}) },
    })
    if (!r.ok) {
      open.value = false
      toast.add({
        title: "That change doesn't fit the spec",
        description: r.issues?.map((i) => i.message).join(' '),
        color: 'error',
      })
      return
    }
    plan.value = r.plan!
  } catch (err) {
    open.value = false
    toast.add({ title: "Couldn't make a plan", description: errorMessage(err), color: 'error' })
  } finally {
    loading.value = false
  }
}

async function apply() {
  if (!plan.value) return
  applying.value = true
  try {
    const r = await $fetch<{ jobId: number }>(`/api/servers/${props.server}/apply` as string, {
      method: 'POST',
      body: { planId: plan.value.id },
    })
    job.value = r.jobId
  } catch (err) {
    toast.add({ title: "Couldn't apply", description: errorMessage(err), color: 'error' })
  } finally {
    applying.value = false
  }
}

function onFinished(e: JobEvent) {
  finished.value = e
  if (e.state === 'succeeded') emit('applied')
}

defineExpose({ propose })
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :dismissible="!job || !!finished"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div v-if="loading" class="flex items-center gap-2 text-sm text-muted">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
        Working out what would change…
      </div>
      <template v-else-if="job">
        <JobProgress
          :job-id="job"
          :steps="SPEC_STEPS"
          success-title="Applied"
          @finished="onFinished"
        />
      </template>
      <SpecPlan v-else-if="plan" :plan="plan" />
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <template v-if="!job">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
          <UButton
            v-if="plan?.changes.length"
            label="Apply"
            icon="i-lucide-check"
            :loading="applying"
            :disabled="plan.problems.length > 0"
            @click="apply"
          />
        </template>
        <UButton
          v-else-if="finished"
          label="Done"
          color="neutral"
          variant="outline"
          @click="open = false"
        />
      </div>
    </template>
  </UModal>
</template>
