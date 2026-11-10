<script setup lang="ts">
import {
  INSTALL_PERMISSIONS,
  PERMISSION_LABELS,
  SERVER_PERMISSIONS,
  type Permission,
} from '#shared/permissions'
import type { PeopleView, RoleView } from '~/utils/people'
/** The built-in roles, and roles made here: named sets of permissions. */

const toast = useToast()
const withElevation = useElevation()
const { data, refresh } = await useFetch<PeopleView>('/api/people')
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
const roleForm = ref<{ id: string | null; name: string; permissions: Permission[] } | null>(null)
const removingRole = ref<RoleView | null>(null)
const PERMISSION_GROUPS = [
  { label: 'On their servers', permissions: SERVER_PERMISSIONS },
  {
    label: 'Across Flytower (only when given for all servers)',
    permissions: INSTALL_PERMISSIONS,
  },
]

function newRole() {
  roleForm.value = { id: null, name: '', permissions: ['server.view'] }
}

function editRole(r: RoleView) {
  roleForm.value = { id: r.id, name: r.name, permissions: [...r.permissions] }
}

function togglePermission(p: Permission, on: boolean | 'indeterminate') {
  const f = roleForm.value
  if (!f) return
  f.permissions =
    on === true ? [...new Set([...f.permissions, p])] : f.permissions.filter((x) => x !== p)
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
          @click="newRole"
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
        </div>
        <div v-if="!r.builtIn && can('roles.manage')" class="flex shrink-0 gap-1">
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
            @click="removingRole = r"
          />
        </div>
      </li>
    </ul>

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
          <fieldset v-for="g in PERMISSION_GROUPS" :key="g.label" class="space-y-2">
            <legend class="mb-1 text-sm font-medium">{{ g.label }}</legend>
            <UCheckbox
              v-for="p in g.permissions"
              :key="p"
              :model-value="roleForm.permissions.includes(p)"
              :label="PERMISSION_LABELS[p].label"
              :description="PERMISSION_LABELS[p].help"
              :disabled="p === 'server.view'"
              :data-e2e="`perm-${p}`"
              @update:model-value="(v: boolean | 'indeterminate') => togglePermission(p, v)"
            />
          </fieldset>
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
