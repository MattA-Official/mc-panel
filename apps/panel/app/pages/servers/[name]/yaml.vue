<script setup lang="ts">
import type { SpecIssue } from '#shared/spec'
import type { PlanView } from '~/components/SpecPlan.vue'

const route = useRoute()
const { server, refresh: refreshServer } = useServerContext()
const name = computed(() => server.value?.name ?? '')
const toast = useToast()

const { data, refresh } = await useFetch<{ yaml: string }>(() => `/api/servers/${name.value}/spec`)
const text = ref('')
const original = ref('')
watch(
  data,
  (d) => {
    if (!d) return
    // Keep edits in progress if the server's spec reloads underneath them.
    if (text.value === original.value) text.value = d.yaml
    original.value = d.yaml
  },
  { immediate: true },
)
const dirty = computed(() => text.value !== original.value)

// Check as you type.
const issues = ref<SpecIssue[]>([])
const checking = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
watch(text, (t) => {
  plan.value = null
  clearTimeout(timer)
  timer = setTimeout(async () => {
    checking.value = true
    try {
      const r = await $fetch<{ ok: boolean; issues?: SpecIssue[] }>('/api/specs/check', {
        method: 'POST',
        body: { yaml: t },
      })
      if (t === text.value) issues.value = r.ok ? [] : (r.issues ?? [])
    } catch {
      // A failed check isn't worth interrupting typing for; Review will say.
    } finally {
      checking.value = false
    }
  }, 500)
})
onBeforeUnmount(() => clearTimeout(timer))

const editor = ref<{ goToLine: (n: number) => void } | null>(null)

// Plan, then apply.
const plan = ref<PlanView | null>(null)
const planning = ref(false)
async function review(upgrade?: true) {
  planning.value = true
  try {
    const r = await $fetch<{ ok: boolean; plan?: PlanView; issues?: SpecIssue[] }>(
      `/api/servers/${name.value}/plan` as string,
      { method: 'POST', body: { yaml: text.value, ...(upgrade ? { upgrade } : {}) } },
    )
    if (!r.ok) {
      issues.value = r.issues ?? []
      toast.add({
        title: 'The spec has problems',
        description: 'Fix the lines marked in red first.',
        color: 'warning',
      })
      return
    }
    plan.value = r.plan!
    if (upgrade && !r.plan!.changes.length) {
      toast.add({ title: 'Everything is up to date', color: 'success' })
    }
  } catch (err) {
    toast.add({ title: "Couldn't make a plan", description: errorMessage(err), color: 'error' })
  } finally {
    planning.value = false
  }
}

const job = ref<number | null>(null)
const finished = ref<JobEvent | null>(null)
const applying = ref(false)
async function apply() {
  if (!plan.value) return
  applying.value = true
  try {
    const r = await $fetch<{ jobId: number }>(`/api/servers/${name.value}/apply` as string, {
      method: 'POST',
      body: { planId: plan.value.id },
    })
    finished.value = null
    job.value = r.jobId
  } catch (err) {
    toast.add({ title: "Couldn't apply", description: errorMessage(err), color: 'error' })
    plan.value = null
  } finally {
    applying.value = false
  }
}
async function onFinished(e: JobEvent) {
  finished.value = e
  if (e.state === 'succeeded') {
    plan.value = null
    text.value = original.value // take the server's version, as it now is
    await refresh()
    text.value = original.value
    refreshServer()
  }
}
function closeJob() {
  job.value = null
  finished.value = null
}

function reset() {
  text.value = original.value
  issues.value = []
}

function download() {
  const url = URL.createObjectURL(new Blob([text.value], { type: 'application/yaml' }))
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `${name.value}.yaml`,
  })
  a.click()
  URL.revokeObjectURL(url)
}

onBeforeRouteLeave(() => {
  if (dirty.value && !window.confirm('Leave without applying your changes to the spec?'))
    return false
})

// Arriving from "Create from YAML" with content to install: show the plan straight away.
onMounted(() => {
  if (route.query.review !== undefined) review()
})
</script>

<template>
  <div v-if="server" class="mx-auto w-full max-w-5xl space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm text-muted">
        The whole server as one document. Edit it, review what would change, then apply.
        <a
          href="/schema/server-v1.json"
          target="_blank"
          class="text-primary underline-offset-2 hover:underline"
          >Schema</a
        >
      </p>
      <div class="flex gap-2">
        <UButton
          label="Check for updates"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :ui="{ label: 'sr-only sm:not-sr-only' }"
          :loading="planning"
          :disabled="dirty"
          @click="review(true)"
        />
        <UButton
          label="Download"
          icon="i-lucide-download"
          color="neutral"
          variant="outline"
          :ui="{ label: 'sr-only sm:not-sr-only' }"
          @click="download"
        />
      </div>
    </div>

    <SpecEditor ref="editor" v-model="text" :issues="issues" />

    <ul v-if="issues.length" class="space-y-1" aria-live="polite">
      <li v-for="(i, n) in issues" :key="n">
        <button
          type="button"
          class="flex w-full items-start gap-2 rounded px-2 py-1 text-left text-sm text-error hover:bg-error/10"
          @click="i.line && editor?.goToLine(i.line)"
        >
          <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-4 shrink-0" />
          <span>
            <span v-if="i.line" class="font-mono">Line {{ i.line }}</span
            ><span v-if="i.line && i.path">, </span>
            <span v-if="i.path" class="font-mono">{{ i.path }}</span
            ><span v-if="i.line || i.path">: </span>{{ i.message }}
          </span>
        </button>
      </li>
    </ul>

    <div class="flex flex-wrap justify-end gap-2">
      <UButton v-if="dirty" label="Reset" color="neutral" variant="ghost" @click="reset" />
      <UButton
        label="Review changes"
        icon="i-lucide-list-checks"
        :loading="planning"
        :disabled="issues.length > 0 || checking"
        @click="review()"
      />
    </div>

    <UCard v-if="plan && !job">
      <template #header>
        <h2 class="font-semibold">What will change</h2>
      </template>
      <SpecPlan :plan="plan" />
      <template v-if="plan.changes.length" #footer>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="plan = null" />
          <UButton
            label="Apply"
            icon="i-lucide-check"
            :loading="applying"
            :disabled="plan.problems.length > 0"
            @click="apply"
          />
        </div>
      </template>
    </UCard>

    <UCard v-if="job">
      <template #header>
        <h2 class="font-semibold">Applying</h2>
      </template>
      <JobProgress
        :job-id="job"
        :steps="SPEC_STEPS"
        success-title="Applied"
        @finished="onFinished"
      />
      <template v-if="finished" #footer>
        <div class="flex justify-end">
          <UButton label="Done" color="neutral" variant="outline" @click="closeJob" />
        </div>
      </template>
    </UCard>
  </div>
</template>
