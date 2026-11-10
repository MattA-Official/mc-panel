<script setup lang="ts">
/** S3-compatible buckets that servers can copy their backups to. */
interface Target {
  id: number
  name: string
  endpoint: string
  region: string
  bucket: string
  prefix: string
  accessKeyId: string
  servers: string[]
}
const toast = useToast()
const withElevation = useElevation()
const { data: targets, refresh } = await useFetch<Target[]>('/api/system/backup-targets', {
  default: () => [],
})

const open = ref(false)
const blank = () => ({
  name: '',
  endpoint: '',
  region: 'auto',
  bucket: '',
  prefix: 'flytower',
  accessKeyId: '',
  secretAccessKey: '',
})
const form = reactive(blank())
const testing = ref(false)
const saving = ref(false)
const result = ref<{ ok: boolean; message: string } | null>(null)

const examples = [
  { label: 'Backblaze B2', endpoint: 'https://s3.<region>.backblazeb2.com' },
  { label: 'Cloudflare R2', endpoint: 'https://<account id>.r2.cloudflarestorage.com' },
  { label: 'Wasabi', endpoint: 'https://s3.<region>.wasabisys.com' },
  { label: 'AWS S3', endpoint: 'https://s3.<region>.amazonaws.com' },
]

async function test() {
  testing.value = true
  result.value = null
  try {
    await $fetch<unknown>('/api/system/backup-targets/test' as string, {
      method: 'POST',
      body: form,
    })
    result.value = { ok: true, message: 'Connected: wrote, read and deleted a test file.' }
  } catch (err) {
    result.value = { ok: false, message: errorMessage(err) }
  } finally {
    testing.value = false
  }
}

async function add() {
  saving.value = true
  try {
    await withElevation(() =>
      $fetch<unknown>('/api/system/backup-targets' as string, { method: 'POST', body: form }),
    )
    toast.add({ title: `Added ${form.name}`, color: 'success' })
    open.value = false
    Object.assign(form, blank())
    result.value = null
    refresh()
  } catch (err) {
    result.value = { ok: false, message: errorMessage(err) }
  } finally {
    saving.value = false
  }
}

const removing = ref<Target | null>(null)
async function remove() {
  const t = removing.value
  if (!t) return
  try {
    await withElevation(() =>
      $fetch<unknown>(`/api/system/backup-targets/${t.id}` as string, { method: 'DELETE' }),
    )
    toast.add({ title: `Removed ${t.name}`, color: 'success' })
    removing.value = null
    refresh()
  } catch (err) {
    toast.add({ title: "Couldn't remove it", description: errorMessage(err), color: 'error' })
  }
}
</script>

<template>
  <UCard data-e2e="offsite-targets">
    <template #header>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <h2 class="text-base font-semibold">Off-site backups</h2>
          <p class="mt-1 text-sm text-muted">
            Buckets that servers can copy their backups to. Choose one per server on its Backups
            tab.
          </p>
        </div>
        <UButton
          icon="i-lucide-plus"
          label="Add storage"
          class="shrink-0 self-start"
          @click="open = true"
        />
      </div>
    </template>
    <ul v-if="targets?.length" class="divide-y divide-default">
      <li v-for="t in targets" :key="t.id" class="flex items-center justify-between gap-4 py-2">
        <div class="min-w-0">
          <p class="font-medium">{{ t.name }}</p>
          <p class="truncate font-mono text-xs text-muted">
            {{ t.bucket }}/{{ t.prefix }} · {{ t.endpoint }}
          </p>
          <p class="text-xs text-muted">
            {{
              t.servers.length ? `Used by ${t.servers.join(', ')}` : 'Not used by any server yet'
            }}
          </p>
        </div>
        <UButton
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          :aria-label="`Remove ${t.name}`"
          @click="removing = t"
        />
      </li>
    </ul>
    <p v-else class="text-sm text-muted">
      None yet. Any S3-compatible storage works: Backblaze B2, Cloudflare R2, Wasabi or AWS S3.
    </p>

    <USlideover v-model:open="open" title="Add storage" :ui="{ content: 'w-full sm:max-w-lg' }">
      <template #body>
        <form class="space-y-4" @submit.prevent="add">
          <UFormField label="Name" required description="Just for you, like “B2” or “R2”.">
            <UInput v-model="form.name" class="w-full" maxlength="40" />
          </UFormField>
          <UFormField label="Endpoint" required>
            <UInput
              v-model="form.endpoint"
              class="w-full font-mono"
              placeholder="https://s3.eu-central-003.backblazeb2.com"
            />
            <template #help>
              <ul class="space-y-0.5 text-xs">
                <li v-for="e in examples" :key="e.label">
                  {{ e.label }}: <code>{{ e.endpoint }}</code>
                </li>
              </ul>
            </template>
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Bucket" description="Its name, as made with your provider." required>
              <UInput v-model="form.bucket" class="w-full font-mono" />
            </UFormField>
            <UFormField label="Region" description="“auto” suits most.">
              <UInput v-model="form.region" class="w-full font-mono" />
            </UFormField>
          </div>
          <UFormField label="Folder in the bucket">
            <UInput v-model="form.prefix" class="w-full font-mono" />
          </UFormField>
          <UFormField label="Access key ID" required>
            <UInput v-model="form.accessKeyId" class="w-full font-mono" autocomplete="off" />
          </UFormField>
          <UFormField
            label="Secret access key"
            required
            description="Stored encrypted, and never shown again."
          >
            <UInput
              v-model="form.secretAccessKey"
              type="password"
              class="w-full font-mono"
              autocomplete="off"
            />
          </UFormField>
          <UAlert
            v-if="result"
            :color="result.ok ? 'success' : 'error'"
            variant="subtle"
            :icon="result.ok ? 'i-lucide-check' : 'i-lucide-circle-alert'"
            :title="result.message"
          />
          <div class="flex justify-end gap-2">
            <UButton
              label="Test"
              color="neutral"
              variant="outline"
              :loading="testing"
              @click="test"
            />
            <UButton type="submit" label="Add" :loading="saving" />
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
          Servers using it stop copying backups off-site. Copies already in the bucket are left
          there, and you're asked for your passkey.
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
