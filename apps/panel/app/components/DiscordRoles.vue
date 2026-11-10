<script setup lang="ts">
/**
 * Which Discord roles get which Flytower roles in slash commands. Discord doesn't tell the
 * app what a role is called, so each mapping carries a name the person picks.
 */
import type { DiscordRoleMapping, DiscordRolesView } from '#shared/discord'

const toast = useToast()
const withElevation = useElevation()
const can = useCan()
const { data, error } = await useFetch<DiscordRolesView>('/api/system/discord/roles')

interface Row {
  discordRoleId: string
  label: string
  roleId: string
  scope: string
}
const toRow = (m: DiscordRoleMapping): Row => ({
  discordRoleId: m.discordRoleId,
  label: m.label,
  roleId: m.roleId,
  scope: m.server ?? '*',
})

const editing = ref(false)
const rows = ref<Row[]>([])
const saving = ref(false)

const roleName = (id: string) =>
  data.value?.roles.find((r) => r.id === id)?.name ?? 'a deleted role'
const serverName = (name: string | null) =>
  name === null
    ? 'all servers'
    : (data.value?.servers.find((s) => s.name === name)?.displayName ?? name)

const roleItems = computed(() =>
  (data.value?.roles ?? []).map((r) => ({ label: r.name, value: r.id })),
)
const scopeItems = computed(() => [
  { label: 'All servers', value: '*' },
  ...(data.value?.servers ?? []).map((s) => ({ label: s.displayName, value: s.name })),
])

function edit() {
  rows.value = (data.value?.mappings ?? []).map(toRow)
  if (!rows.value.length) add()
  editing.value = true
}
function add() {
  rows.value.push({ discordRoleId: '', label: '', roleId: 'operator', scope: '*' })
}

const ID = /^\d{5,25}$/
const invalid = computed(() =>
  rows.value.some((r) => !ID.test(r.discordRoleId.trim()) || !r.label.trim() || !r.roleId),
)

async function save() {
  saving.value = true
  try {
    const mappings: DiscordRoleMapping[] = rows.value.map((r) => ({
      discordRoleId: r.discordRoleId.trim(),
      label: r.label.trim(),
      roleId: r.roleId,
      server: r.scope === '*' ? null : r.scope,
    }))
    const saved = await withElevation(() =>
      $fetch<{ mappings: DiscordRoleMapping[] }>('/api/system/discord/roles', {
        method: 'PUT',
        body: { mappings },
      }),
    )
    if (data.value) data.value.mappings = saved.mappings
    editing.value = false
    toast.add({ title: 'Saved the Discord roles', color: 'success' })
  } catch (err) {
    toast.add({ title: "Couldn't save", description: errorMessage(err), color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="space-y-3 border-t border-default pt-4" data-e2e="discord-roles">
    <div class="flex items-center justify-between gap-3">
      <h3 class="font-medium">Discord roles</h3>
      <UButton
        v-if="!editing && data && can('people.manage')"
        :label="data.mappings.length ? 'Change' : 'Give a Discord role access'"
        size="sm"
        color="neutral"
        variant="outline"
        @click="edit"
      />
    </div>
    <UAlert v-if="error" color="error" variant="subtle" :title="errorMessage(error)" />

    <template v-else-if="data && !editing">
      <p class="text-muted">
        Members of these Discord roles can use the staff commands with the same access as the
        Flytower role. Everyone else can use <code>/status</code> and <code>/players</code>.
      </p>
      <ul v-if="data.mappings.length" class="space-y-1" data-e2e="discord-role-list">
        <li v-for="(m, n) in data.mappings" :key="n">
          <span class="font-medium">{{ m.label }}</span>
          <span class="text-muted"> gets </span>
          {{ roleName(m.roleId) }}
          <span class="text-muted"> on </span>
          {{ serverName(m.server) }}
        </li>
      </ul>
      <p v-else class="text-muted italic">No Discord roles have access yet.</p>
    </template>

    <form v-else-if="data" class="space-y-3" @submit.prevent="save">
      <p class="text-muted">
        To find a role's ID, turn on Developer Mode in Discord (User Settings, Advanced), then
        right-click the role in Server Settings, Roles, and choose Copy Role ID. Owner can't be
        given out through Discord.
      </p>
      <div
        v-for="(r, n) in rows"
        :key="n"
        class="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto_auto_auto] sm:items-center"
        data-e2e="discord-role-row"
      >
        <UInput v-model="r.label" placeholder="Name, like Staff" aria-label="Discord role name" />
        <UInput
          v-model="r.discordRoleId"
          placeholder="Discord role ID"
          inputmode="numeric"
          class="font-mono"
          aria-label="Discord role ID"
        />
        <USelect v-model="r.roleId" :items="roleItems" class="sm:w-36" aria-label="Flytower role" />
        <span class="hidden text-muted sm:inline">on</span>
        <USelect v-model="r.scope" :items="scopeItems" class="sm:w-40" aria-label="Servers" />
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          aria-label="Remove this Discord role"
          @click="rows.splice(n, 1)"
        />
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <UButton
          label="Add a Discord role"
          icon="i-lucide-plus"
          size="sm"
          color="neutral"
          variant="ghost"
          @click="add"
        />
        <div class="flex gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="editing = false" />
          <UButton type="submit" label="Save" :loading="saving" :disabled="invalid" />
        </div>
      </div>
      <p class="text-xs text-muted">Saving asks for your passkey.</p>
    </form>
  </section>
</template>
