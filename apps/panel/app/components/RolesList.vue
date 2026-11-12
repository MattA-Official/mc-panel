<script setup lang="ts">
import {
  impliedBy,
  PERMISSION_AREAS,
  PERMISSION_LABELS,
  POWERFUL,
  type Permission,
} from '#shared/permissions'
import type { PeopleView, RoleView } from '~/utils/people'
/** The built-in roles, and roles made here: named sets of permissions. */

const toast = useToast()
const withElevation = useElevation()
const { data, refresh } = await useFetch<PeopleView>('/api/people')
const { data: servers } = await useFetch<Server[]>('/api/servers', { default: () => [] })
const serverName = (name: string) => servers.value.find((s) => s.name === name)?.displayName ?? name
const busy = ref(false)

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

const can = useCan()
/** `permissions` holds what was ticked; what those bring along is shown ticked and locked. */
const roleForm = ref<{ id: string | null; name: string; permissions: Permission[] } | null>(null)
const removingRole = ref<RoleView | null>(null)
const SECTIONS = [
  { label: 'On their servers', areas: PERMISSION_AREAS.filter((a) => !a.install) },
  {
    label: 'Across Flytower',
    note: 'Only when the role is given for all servers.',
    areas: PERMISSION_AREAS.filter((a) => a.install),
  },
]

const implied = computed(() => impliedBy(roleForm.value?.permissions ?? []))
const ticked = (p: Permission) =>
  !!roleForm.value?.permissions.includes(p) || implied.value[p] !== undefined
const lockedReason = (p: Permission) => {
  const by = implied.value[p]
  if (by && !roleForm.value?.permissions.includes(p)) {
    return `Included with ${PERMISSION_LABELS[by].label}.`
  }
  if (!can(p)) return "You don't have this yourself, so you can't give it."
  return null
}

/** Who holds each role and where, for the list. */
const holders = computed(() => {
  const out: Record<string, { all: number; servers: Record<string, number> }> = {}
  for (const person of data.value?.people ?? []) {
    for (const g of person.grants) {
      const h = (out[g.roleId] ??= { all: 0, servers: {} })
      if (g.server === null) h.all++
      else h.servers[g.server] = (h.servers[g.server] ?? 0) + 1
    }
  }
  return out
})
function holdersText(id: string) {
  const h = holders.value[id]
  if (!h) return 'Nobody has it.'
  const parts = [
    ...(h.all ? [`${h.all} on all servers`] : []),
    ...Object.entries(h.servers).map(([s, n]) => `${n} on ${serverName(s)}`),
  ]
  return `${parts.join(', ')}.`
}

/** Starting points for a new role: blank, or a copy of any role. */
const BLANK = '-'
const startItems = computed(() => [
  { label: 'Blank', value: BLANK },
  ...(data.value?.roles ?? []).map((r) => ({ label: r.name, value: r.id })),
])
const startFrom = ref(BLANK)

/** What was ticked in a saved role: leaves out what the rest brings along. */
function chosen(ps: readonly Permission[]) {
  const brought = impliedBy(ps)
  return ps.filter((p) => brought[p] === undefined)
}

/** A copy keeps only what this person could give themselves. */
const mine = (ps: readonly Permission[]) => chosen(ps.filter((p) => can(p)))

function newRole(from?: RoleView) {
  startFrom.value = from?.id ?? BLANK
  roleForm.value = {
    id: null,
    name: from ? `Copy of ${from.name}` : '',
    permissions: from ? mine(from.permissions) : ['server.view'],
  }
}

watch(startFrom, (id) => {
  const f = roleForm.value
  if (!f || f.id) return
  const from = data.value?.roles.find((r) => r.id === id)
  f.permissions = from ? mine(from.permissions) : ['server.view']
  if (from && (!f.name || f.name.startsWith('Copy of '))) f.name = `Copy of ${from.name}`
})

function editRole(r: RoleView) {
  roleForm.value = { id: r.id, name: r.name, permissions: chosen(r.permissions) }
}

function togglePermission(p: Permission, on: boolean | 'indeterminate') {
  const f = roleForm.value
  if (!f) return
  f.permissions =
    on === true ? [...new Set([...f.permissions, p])] : f.permissions.filter((x) => x !== p)
}

/** Ticks or clears every permission in an area that this person can give. */
function toggleArea(ps: readonly Permission[]) {
  const f = roleForm.value
  if (!f) return
  const open = ps.filter((p) => can(p))
  const all = open.every(ticked)
  f.permissions = all
    ? f.permissions.filter((p) => !open.includes(p))
    : [...new Set([...f.permissions, ...open])]
}

async function saveRole() {
  const f = roleForm.value
  if (!f) return
  busy.value = true
  const body = { name: f.name, permissions: f.permissions }
  const ok = await act(
    () =>
      f.id
        ? $fetch<unknown>(`/api/people/roles/${f.id}` as string, { method: 'PUT', body })
        : $fetch<unknown>('/api/people/roles', { method: 'POST', body }),
    f.id ? `Saved the ${f.name} role` : `Made the ${f.name} role`,
  )
  busy.value = false
  if (ok) roleForm.value = null
}

async function deleteRole() {
  const r = removingRole.value
  if (!r) return
  const ok = await act(
    () => $fetch<unknown>(`/api/people/roles/${r.id}` as string, { method: 'DELETE' }),
    `Deleted the ${r.name} role`,
  )
  if (ok) removingRole.value = null
}
</script>

<template>
  <UCard data-e2e="roles">
    <template #header>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <h2 class="text-base font-semibold">Roles</h2>
          <p class="mt-1 text-sm text-muted">
            What each role lets someone do. Make your own from any mix of permissions.
          </p>
        </div>
        <UButton
          v-if="can('roles.manage')"
          icon="i-lucide-plus"
          label="New role"
          class="shrink-0 self-start"
          data-e2e="role-new"
          @click="newRole()"
        />
      </div>
    </template>

    <ul class="divide-y divide-default">
      <li
        v-for="r in data?.roles ?? []"
        :key="r.id"
        class="flex items-center justify-between gap-4 py-2"
      >
        <div class="min-w-0 text-sm">
          <p class="flex items-center gap-2 font-medium">
            {{ r.name }}
            <UBadge v-if="r.builtIn" label="Built in" variant="subtle" color="neutral" size="sm" />
          </p>
          <p class="text-xs text-muted">{{ roleHelp(r) }}</p>
          <p class="text-xs text-dimmed" :data-e2e="`role-holders-${r.id}`">
            {{ holdersText(r.id) }}
          </p>
        </div>
        <div v-if="can('roles.manage')" class="flex shrink-0 gap-1">
          <UButton
            icon="i-lucide-copy"
            color="neutral"
            variant="ghost"
            :aria-label="`Make a copy of the ${r.name} role`"
            :data-e2e="`role-copy-${r.id}`"
            @click="newRole(r)"
          />
          <template v-if="!r.builtIn">
            <UButton
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              :aria-label="`Edit the ${r.name} role`"
              @click="editRole(r)"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="neutral"
              variant="ghost"
              :aria-label="`Delete the ${r.name} role`"
              :disabled="!!holders[r.id]"
              @click="removingRole = r"
            />
          </template>
        </div>
      </li>
    </ul>
    <p v-if="can('roles.manage')" class="mt-3 text-xs text-muted">
      Built-in roles can't be changed, but you can copy one and change the copy.
    </p>

    <USlideover
      :open="!!roleForm"
      :title="roleForm?.id ? `Edit ${roleForm.name}` : 'New role'"
      :ui="{ content: 'w-full sm:max-w-lg' }"
      @update:open="(o: boolean) => !o && (roleForm = null)"
    >
      <template #body>
        <form v-if="roleForm" class="space-y-4" @submit.prevent="saveRole">
          <UFormField label="Name" required>
            <UInput
              v-model="roleForm.name"
              maxlength="40"
              class="w-full"
              placeholder="Moderator"
              data-e2e="role-name"
            />
          </UFormField>
          <UFormField v-if="!roleForm.id" label="Start from">
            <USelect v-model="startFrom" :items="startItems" class="w-full" data-e2e="role-start" />
          </UFormField>
          <section v-for="sec in SECTIONS" :key="sec.label" class="space-y-4">
            <div>
              <h3 class="text-sm font-semibold">{{ sec.label }}</h3>
              <p v-if="sec.note" class="text-xs text-muted">{{ sec.note }}</p>
            </div>
            <fieldset v-for="a in sec.areas" :key="a.label" class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <legend class="text-sm font-medium">{{ a.label }}</legend>
                <UButton
                  v-if="a.permissions.length > 1"
                  size="xs"
                  color="neutral"
                  variant="link"
                  :label="a.permissions.filter((p) => can(p)).every(ticked) ? 'Clear' : 'All'"
                  :disabled="!a.permissions.some((p) => can(p) && !lockedReason(p))"
                  :aria-label="`Tick all of ${a.label}`"
                  @click="toggleArea(a.permissions)"
                />
              </div>
              <UCheckbox
                v-for="p in a.permissions"
                :key="p"
                :model-value="ticked(p)"
                :description="lockedReason(p) ?? PERMISSION_LABELS[p].help"
                :disabled="!!lockedReason(p)"
                :data-e2e="`perm-${p}`"
                @update:model-value="(v: boolean | 'indeterminate') => togglePermission(p, v)"
              >
                <template #label>
                  <span class="inline-flex flex-wrap items-center gap-2">
                    {{ PERMISSION_LABELS[p].label }}
                    <UTooltip v-if="POWERFUL[p]" :text="POWERFUL[p]">
                      <UBadge
                        label="Powerful"
                        color="warning"
                        variant="subtle"
                        size="sm"
                        icon="i-lucide-triangle-alert"
                        :data-e2e="`powerful-${p}`"
                      />
                    </UTooltip>
                  </span>
                </template>
              </UCheckbox>
              <p
                v-for="p in a.permissions.filter((x) => POWERFUL[x] && ticked(x))"
                :key="`why-${p}`"
                class="text-xs text-warning"
              >
                {{ PERMISSION_LABELS[p].label }}: {{ POWERFUL[p] }}
              </p>
            </fieldset>
          </section>
          <p class="text-xs text-muted">
            Changes apply straight away to everyone with this role. Saving asks for your passkey.
          </p>
          <div class="flex justify-end gap-2">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="roleForm = null" />
            <UButton
              type="submit"
              :label="roleForm.id ? 'Save' : 'Make role'"
              :loading="busy"
              :disabled="!roleForm.name.trim()"
              data-e2e="role-save"
            />
          </div>
        </form>
      </template>
    </USlideover>

    <UModal
      :open="!!removingRole"
      :title="`Delete the ${removingRole?.name} role?`"
      @update:open="(o: boolean) => !o && (removingRole = null)"
    >
      <template #body>
        <p class="text-sm">
          Only a role nobody has can be deleted. Unused invite links for it are cancelled too.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="removingRole = null" />
          <UButton label="Delete" color="error" @click="deleteRole" />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
