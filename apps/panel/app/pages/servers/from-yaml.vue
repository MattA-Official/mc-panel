<script setup lang="ts">
import type { SpecIssue } from '#shared/spec'

useHead({ title: 'New server from YAML' })
const toast = useToast()

const EXAMPLE = `# yaml-language-server: $schema=/schema/server-v1.json
name: survival
displayName: Survival
loader:
  type: fabric
  minecraft: "26.3"
memory: 4G
properties:
  motd: Welcome!
  difficulty: normal
content:
  - modrinth: lithium
`

const text = ref(EXAMPLE)
const acceptEula = ref(false)
const issues = ref<SpecIssue[]>([])
const editor = ref<{ goToLine: (n: number) => void } | null>(null)

let timer: ReturnType<typeof setTimeout> | undefined
watch(text, (t) => {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    const r = await $fetch<{ ok: boolean; issues?: SpecIssue[] }>('/api/specs/check', {
      method: 'POST',
      body: { yaml: t },
    }).catch(() => null)
    if (r && t === text.value) issues.value = r.ok ? [] : (r.issues ?? [])
  }, 500)
})
onBeforeUnmount(() => clearTimeout(timer))

const jobId = ref<number | null>(null)
const finished = ref<JobEvent | null>(null)
const created = ref<{ name: string; hasContent: boolean } | null>(null)
const busy = ref(false)

async function create() {
  busy.value = true
  try {
    const r = await $fetch<{
      ok: boolean
      jobId?: number
      hasContent?: boolean
      issues?: SpecIssue[]
    }>('/api/servers/from-spec', {
      method: 'POST',
      body: { yaml: text.value, acceptEula: acceptEula.value },
    })
    if (!r.ok) {
      issues.value = r.issues ?? []
      return
    }
    const name = (/^name:\s*["']?([a-z][a-z0-9-]*)/m.exec(text.value)?.[1] ?? '') as string
    created.value = { name, hasContent: !!r.hasContent }
    finished.value = null
    jobId.value = r.jobId!
  } catch (err) {
    toast.add({ title: "Couldn't create it", description: errorMessage(err), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) text.value = await file.text()
}
</script>

<template>
  <UDashboardPanel id="new-server-yaml">
    <template #header>
      <UDashboardNavbar title="New server from YAML">
        <template #leading>
          <UButton icon="i-lucide-arrow-left" variant="ghost" color="neutral" to="/servers/new" />
        </template>
        <template #right><HelpButton /></template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-3xl space-y-4">
        <div v-if="jobId && created" class="space-y-6">
          <h2 class="font-display text-2xl tracking-wide uppercase">Building {{ created.name }}</h2>
          <JobProgress :job-id="jobId" :steps="CREATE_SERVER_STEPS" @finished="finished = $event" />
          <UAlert
            v-if="finished?.state === 'succeeded' && created.hasContent"
            color="info"
            variant="subtle"
            icon="i-lucide-package"
            title="Your spec lists content"
            description="Nothing has been downloaded yet. Review the plan and apply it to install it."
          />
          <div v-if="finished" class="flex gap-3">
            <UButton
              v-if="finished.state === 'succeeded'"
              :label="created.hasContent ? 'Review content' : 'Go to server'"
              icon="i-lucide-arrow-right"
              trailing
              :to="
                created.hasContent
                  ? `/servers/${created.name}/settings/yaml?review`
                  : `/servers/${created.name}`
              "
            />
            <UButton
              v-else
              label="Change the spec and try again"
              icon="i-lucide-rotate-ccw"
              @click="jobId = null"
            />
          </div>
        </div>

        <template v-else>
          <p class="text-sm text-muted">
            Paste a spec, or open a <code>.yaml</code> file. Only <code>name</code> and
            <code>loader</code> are needed; everything else has a sensible default.
          </p>
          <div class="flex justify-end">
            <label
              class="inline-flex cursor-pointer items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <UIcon name="i-lucide-file-up" class="size-4" />
              Open a file
              <input type="file" accept=".yaml,.yml,text/yaml" class="sr-only" @change="onFile" />
            </label>
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
          <UCheckbox v-model="acceptEula">
            <template #label>
              I accept the
              <a
                href="https://aka.ms/MinecraftEULA"
                target="_blank"
                rel="noopener"
                class="text-primary underline-offset-2 hover:underline"
                >Minecraft EULA</a
              >
            </template>
          </UCheckbox>
          <div class="flex justify-end">
            <UButton
              label="Create"
              icon="i-lucide-hammer"
              :loading="busy"
              :disabled="!acceptEula || issues.length > 0"
              @click="create"
            />
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
