<script setup lang="ts">
import type { GrantView, InviteView, PeopleView, Person } from '~/utils/people'
/** Everyone who can sign in, what they can do, and invite links nobody has used yet. */
const toast = useToast()
const can = useCan()
const withElevation = useElevation()
const { data, refresh } = await useFetch<PeopleView>('/api/people')
const { data: servers } = await useFetch<Server[]>('/api/servers', { default: () => [] })

const roleName = (id: string) => data.value?.roles.find((r) => r.id === id)?.name ?? id
const serverName = (name: string | null) =>
  name === null ? 'all servers' : (servers.value.find((s) => s.name === name)?.displayName ?? name)
const grantText = (g: GrantView) => `${roleName(g.roleId)} on ${serverName(g.server)}`

const roleItems = computed(() =>
  (data.value?.roles ?? []).map((r) => ({
    label: r.name,
    value: r.id,
    description: roleHelp(r),
  })),
)
const selectedRoleHelp = (id: string) => {
  const r = data.value?.roles.find((x) => x.id === id)
  return r ? roleHelp(r) : undefined
}
const scopeItems = computed(() => [
  { label: 'All servers', value: '*' },
  ...servers.value.map((s) => ({ label: s.displayName, value: s.name })),
])
const toScope = (server: string | null) => server ?? '*'
const fromScope = (scope: string) => (scope === '*' ? null : scope)

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

// ------------------------------------------------------------------ invite

const inviting = ref(false)
const invite = reactive({ note: '', roleId: 'operator', scope: '*' })
const link = ref<{ url: string; expiresAt: string } | null>(null)
const busy = ref(false)

function startInvite() {
  Object.assign(invite, { note: '', roleId: 'operator', scope: '*' })
  link.value = null
  inviting.value = true
}

async function createInvite() {
  busy.value = true
  try {
    link.value = await withElevation(() =>
      $fetch<{ url: string; expiresAt: string }>('/api/people/invites', {
        method: 'POST',
        body: {
          note: invite.note.trim() || null,
          roleId: invite.roleId,
          server: fromScope(invite.scope),
        },
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

const cancelInvite = (i: InviteView) =>
  act(
    () => $fetch<unknown>(`/api/people/invites/${i.id}` as string, { method: 'DELETE' }),
    'Invite cancelled',
  )

// ------------------------------------------------------------------ change

const editing = ref<Person | null>(null)
const rows = ref<{ roleId: string; scope: string }[]>([])

function edit(p: Person) {
  editing.value = p
  rows.value = p.grants.map((g) => ({ roleId: g.roleId, scope: toScope(g.server) }))
  if (!rows.value.length) rows.value.push({ roleId: 'viewer', scope: '*' })
}

async function saveGrants() {
  const p = editing.value
  if (!p) return
  busy.value = true
  const ok = await act(
    () =>
      $fetch<unknown>(`/api/people/${p.id}/grants` as string, {
        method: 'PUT',
        body: { grants: rows.value.map((r) => ({ roleId: r.roleId, server: fromScope(r.scope) })) },
      }),
    `Saved what ${p.name} can do`,
  )
  busy.value = false
  if (ok) editing.value = null
}

// ------------------------------------------------------------------ remove

const removing = ref<Person | null>(null)

async function remove() {
  const p = removing.value
  if (!p) return
  if (
    await act(
      () => $fetch<unknown>(`/api/people/${p.id}` as string, { method: 'DELETE' }),
      `Removed ${p.name}`,
    )
  ) {
    removing.value = null
  }
}
</script>

<template>
  <UCard data-e2e="people">
    <template #header>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <h2 class="text-base font-semibold">People</h2>
          <p class="mt-1 text-sm text-muted">
            Who can sign in, and what they can do. Invite someone with a one-time link, for one
            server or all of them.
          </p>
        </div>
        <UButton
          icon="i-lucide-user-plus"
          label="Invite someone"
          class="shrink-0 self-start"
          data-e2e="invite"
          @click="startInvite"
        />
      </div>
    </template>

    <ul class="divide-y divide-default">
      <li
        v-for="p in data?.people ?? []"
        :key="p.id"
        class="flex items-center justify-between gap-4 py-2"
        :data-e2e="`person-${p.name}`"
      >
        <div class="min-w-0">
          <p class="flex flex-wrap items-center gap-2 font-medium">
            {{ p.name }}
            <UBadge
              v-if="p.id === data?.you"
              label="You"
              variant="subtle"
              color="primary"
              size="sm"
            />
          </p>
          <p class="flex flex-wrap gap-1 pt-0.5">
            <UBadge
              v-for="g in p.grants"
              :key="`${g.roleId}-${g.server}`"
              :label="grantText(g)"
              variant="subtle"
              color="neutral"
              size="sm"
            />
            <span v-if="!p.grants.length" class="text-xs text-warning">No access</span>
          </p>
          <p class="text-xs text-muted">
            {{
              p.lastSignIn
                ? `Last signed in ${formatDateTime(p.lastSignIn)}`
                : `Joined ${formatDateTime(p.joinedAt)}`
            }}
            · {{ p.passkeys }} {{ p.passkeys === 1 ? 'passkey' : 'passkeys' }}
          </p>
        </div>
        <div v-if="can('people.manage')" class="flex shrink-0 gap-1">
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="ghost"
            :aria-label="`Change what ${p.name} can do`"
            @click="edit(p)"
          />
          <UButton
            v-if="p.id !== data?.you"
            icon="i-lucide-user-minus"
            color="neutral"
            variant="ghost"
            :aria-label="`Remove ${p.name}`"
            @click="removing = p"
          />
        </div>
      </li>
    </ul>

    <template v-if="data?.invites.length">
      <h3 class="mt-6 text-sm font-medium">Invite links not used yet</h3>
      <ul class="mt-1 divide-y divide-default">
        <li
          v-for="i in data.invites"
          :key="i.id"
          class="flex items-center justify-between gap-4 py-2"
        >
          <div class="min-w-0 text-sm">
            <p>
              <span v-if="i.note" class="font-medium">{{ i.note }}: </span>
              {{ grantText(i) }}
            </p>
            <p class="text-xs text-muted">
              {{ i.invitedBy ? `From ${i.invitedBy}, ` : '' }}works until
              {{ formatDateTime(i.expiresAt) }}
            </p>
          </div>
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="cancelInvite(i)"
          />
        </li>
      </ul>
    </template>

    <UModal v-model:open="inviting" title="Invite someone">
      <template #body>
        <div v-if="link" class="space-y-3" data-e2e="invite-link">
          <p class="text-sm">
            Send this link to them. It works once, until {{ formatDateTime(link.expiresAt) }}, and
            this is the only time it's shown.
          </p>
          <div class="flex gap-2">
            <UInput :model-value="link.url" readonly class="w-full font-mono" />
            <UButton icon="i-lucide-copy" label="Copy" @click="copyLink" />
          </div>
          <p class="text-xs text-muted">
            They choose their name, create a passkey and save recovery codes. You can cancel the
            link here until they do.
          </p>
        </div>
        <form v-else class="space-y-4" @submit.prevent="createInvite">
          <UFormField label="Who it's for" hint="Optional" description="Only you see this.">
            <UInput v-model="invite.note" maxlength="60" class="w-full" placeholder="Sam" />
          </UFormField>
          <UFormField label="Role" :description="selectedRoleHelp(invite.roleId)">
            <USelect
              v-model="invite.roleId"
              :items="roleItems"
              class="w-full"
              data-e2e="invite-role"
            />
          </UFormField>
          <UFormField label="On">
            <USelect
              v-model="invite.scope"
              :items="scopeItems"
              class="w-full"
              data-e2e="invite-scope"
            />
          </UFormField>
          <p class="text-xs text-muted">Making the link asks for your passkey.</p>
          <div class="flex justify-end">
            <UButton type="submit" label="Make link" :loading="busy" data-e2e="invite-create" />
          </div>
        </form>
      </template>
    </UModal>

    <UModal
      :open="!!editing"
      :title="`What ${editing?.name} can do`"
      @update:open="(o: boolean) => !o && (editing = null)"
    >
      <template #body>
        <form class="space-y-3" @submit.prevent="saveGrants">
          <div v-for="(r, n) in rows" :key="n" class="flex items-center gap-2">
            <USelect v-model="r.roleId" :items="roleItems" class="w-36" />
            <span class="text-sm text-muted">on</span>
            <USelect v-model="r.scope" :items="scopeItems" class="min-w-0 flex-1" />
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              aria-label="Remove this role"
              @click="rows.splice(n, 1)"
            />
          </div>
          <UButton
            icon="i-lucide-plus"
            label="Add a role"
            color="neutral"
            variant="outline"
            size="sm"
            @click="rows.push({ roleId: 'viewer', scope: '*' })"
          />
          <p class="text-xs text-muted">
            Roles add up. Changes apply straight away, and saving asks for your passkey.
          </p>
          <div class="flex justify-end gap-2">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="editing = null" />
            <UButton type="submit" label="Save" :loading="busy" />
          </div>
        </form>
      </template>
    </UModal>

    <UModal
      :open="!!removing"
      :title="`Remove ${removing?.name}?`"
      @update:open="(o: boolean) => !o && (removing = null)"
    >
      <template #body>
        <p class="text-sm">
          They're signed out straight away and their passkeys stop working. You can invite them
          again later. You're asked for your passkey.
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
