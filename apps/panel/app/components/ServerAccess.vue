<script setup lang="ts">
/** Who can reach this server, and changing their roles on it alone. */
interface AccessPerson {
  id: number
  name: string
  grants: { roleId: string; server: string | null }[]
}
interface AccessView {
  people: AccessPerson[]
  others: { id: number; name: string }[]
  roles: { id: string; name: string }[]
  allRoles: { id: string; name: string }[]
  invites: { id: number; roleId: string; note: string | null; expiresAt: string }[]
  you: number
}

const { server } = useServerContext()
const name = computed(() => server.value?.name ?? '')
const toast = useToast()
const can = useCan()
const withElevation = useElevation()
const { data, refresh } = await useFetch<AccessView>(() => `/api/servers/${name.value}/access`)

const roleName = (id: string) => data.value?.allRoles.find((r) => r.id === id)?.name ?? id
const roleItems = computed(() =>
  (data.value?.roles ?? []).map((r) => ({ label: r.name, value: r.id })),
)
const here = (p: AccessPerson) => p.grants.filter((g) => g.server !== null).map((g) => g.roleId)
const everywhere = (p: AccessPerson) =>
  p.grants.filter((g) => g.server === null).map((g) => g.roleId)

async function act(fn: () => Promise<unknown>, done: string) {
  try {
    await withElevation(fn)
    toast.add({ title: done, color: 'success' })
    await refresh()
    return true
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
    return false
  }
}

// ------------------------------------------------------------------ change someone's roles

const editing = ref<{ id: number | null; name: string; roles: string[] } | null>(null)
const busy = ref(false)
const personItems = computed(() =>
  (data.value?.others ?? []).map((p) => ({ label: p.name, value: p.id })),
)

function edit(p: AccessPerson) {
  editing.value = { id: p.id, name: p.name, roles: here(p) }
}
function add() {
  editing.value = { id: null, name: '', roles: [] }
}

async function save() {
  const e = editing.value
  if (!e?.id) return
  busy.value = true
  const who = e.name || data.value?.others.find((p) => p.id === e.id)?.name || 'them'
  const ok = await act(
    () =>
      $fetch<unknown>(`/api/servers/${name.value}/access/${e.id}` as string, {
        method: 'PUT',
        body: { roles: e.roles },
      }),
    `Saved what ${who} can do here`,
  )
  busy.value = false
  if (ok) editing.value = null
}

// ------------------------------------------------------------------ invite

const inviting = ref(false)
const invite = reactive({ note: '', roleId: '' })
const link = ref<{ url: string } | null>(null)

function startInvite() {
  Object.assign(invite, { note: '', roleId: data.value?.roles[0]?.id ?? '' })
  link.value = null
  inviting.value = true
}

async function createInvite() {
  busy.value = true
  try {
    link.value = await withElevation(() =>
      $fetch<{ url: string }>(`/api/servers/${name.value}/access/invites` as string, {
        method: 'POST',
        body: { roleId: invite.roleId, note: invite.note.trim() || null },
      }),
    )
    await refresh()
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function copyLink() {
  if (!link.value) return
  await navigator.clipboard.writeText(link.value.url)
  toast.add({ title: 'Link copied', color: 'success' })
}

const cancelInvite = (id: number) =>
  act(
    () =>
      $fetch<unknown>(`/api/servers/${name.value}/access/invites/${id}` as string, {
        method: 'DELETE',
      }),
    'Invite cancelled',
  )
</script>

<template>
  <UCard data-e2e="server-access">
    <template #header>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <h2 class="text-base font-semibold">Who has access</h2>
          <p class="mt-1 text-sm text-muted">
            Everyone who can reach this server, and the roles they have on it. Roles given for all
            servers are changed on
            <ULink v-if="can('people.manage')" to="/access" class="underline">Access</ULink
            ><span v-else>Access</span>.
          </p>
        </div>
        <div class="flex shrink-0 gap-2 self-start">
          <UButton
            icon="i-lucide-user-plus"
            label="Invite"
            variant="outline"
            :disabled="!data?.roles.length"
            data-e2e="server-access-invite"
            @click="startInvite"
          />
          <UButton
            icon="i-lucide-plus"
            label="Add someone"
            :disabled="!data?.others.length || !data?.roles.length"
            data-e2e="server-access-add"
            @click="add"
          />
        </div>
      </div>
    </template>

    <ul class="divide-y divide-default">
      <li
        v-for="p in data?.people ?? []"
        :key="p.id"
        class="flex items-center justify-between gap-4 py-2"
        :data-e2e="`server-access-${p.name}`"
      >
        <div class="min-w-0">
          <p class="flex flex-wrap items-center gap-2 font-medium">
            {{ p.name }}
            <UBadge v-if="p.id === data?.you" label="You" variant="subtle" size="sm" />
          </p>
          <p class="flex flex-wrap gap-1 pt-0.5">
            <UBadge
              v-for="r in here(p)"
              :key="`here-${r}`"
              :label="`${roleName(r)} here`"
              variant="subtle"
              color="primary"
              size="sm"
            />
            <UBadge
              v-for="r in everywhere(p)"
              :key="`all-${r}`"
              :label="`${roleName(r)} on all servers`"
              variant="subtle"
              color="neutral"
              size="sm"
            />
          </p>
        </div>
        <UButton
          icon="i-lucide-pencil"
          color="neutral"
          variant="ghost"
          :aria-label="`Change ${p.name}'s roles on this server`"
          @click="edit(p)"
        />
      </li>
    </ul>

    <div v-if="data?.invites.length" class="mt-4 space-y-1">
      <h3 class="text-sm font-medium">Invite links not used yet</h3>
      <ul class="divide-y divide-default text-sm">
        <li
          v-for="i in data.invites"
          :key="i.id"
          class="flex items-center justify-between gap-4 py-1.5"
        >
          <span class="min-w-0">
            {{ roleName(i.roleId) }}<span v-if="i.note" class="text-muted"> · {{ i.note }}</span>
            <span class="block text-xs text-muted">Until {{ formatDateTime(i.expiresAt) }}</span>
          </span>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            :aria-label="`Cancel the invite for ${i.note ?? roleName(i.roleId)}`"
            @click="cancelInvite(i.id)"
          />
        </li>
      </ul>
    </div>

    <UModal
      :open="!!editing"
      :title="editing?.id && editing.name ? `${editing.name} on this server` : 'Add someone'"
      @update:open="(o: boolean) => !o && (editing = null)"
    >
      <template #body>
        <form v-if="editing" class="space-y-4" @submit.prevent="save">
          <UFormField v-if="!editing.name" label="Person" required>
            <USelect
              v-model="editing.id as number"
              :items="personItems"
              placeholder="Choose someone"
              class="w-full"
              data-e2e="server-access-person"
            />
          </UFormField>
          <UFormField
            label="Roles on this server"
            help="Only roles you could have here yourself. None takes them off this server."
          >
            <USelectMenu
              v-model="editing.roles"
              :items="roleItems"
              value-key="value"
              multiple
              class="w-full"
              placeholder="No roles here"
              data-e2e="server-access-roles"
            />
          </UFormField>
          <p class="text-xs text-muted">Saving asks for your passkey.</p>
          <div class="flex justify-end gap-2">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="editing = null" />
            <UButton
              type="submit"
              label="Save"
              :loading="busy"
              :disabled="!editing.id"
              data-e2e="server-access-save"
            />
          </div>
        </form>
      </template>
    </UModal>

    <UModal
      v-model:open="inviting"
      title="Invite someone to this server"
      description="A one-time link that lasts 7 days."
    >
      <template #body>
        <div v-if="link" class="space-y-3">
          <p class="text-sm">Send this link to them. It's only shown once.</p>
          <div class="flex gap-2">
            <UInput :model-value="link.url" readonly class="min-w-0 flex-1 font-mono" />
            <UButton icon="i-lucide-copy" label="Copy" @click="copyLink" />
          </div>
        </div>
        <form v-else class="space-y-4" @submit.prevent="createInvite">
          <UFormField label="Role on this server" required>
            <USelect v-model="invite.roleId" :items="roleItems" class="w-full" />
          </UFormField>
          <UFormField label="Who it's for" help="Optional, only shown to people managing access.">
            <UInput v-model="invite.note" maxlength="60" class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="inviting = false" />
            <UButton type="submit" label="Make link" :loading="busy" :disabled="!invite.roleId" />
          </div>
        </form>
      </template>
    </UModal>
  </UCard>
</template>
