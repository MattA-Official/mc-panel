<script setup lang="ts">
interface PlayersView {
  running: boolean
  online: { count: number; max: number; names: string[] } | null
  whitelistEnabled: boolean
  onlineMode: boolean
  whitelist: { uuid: string; name: string }[]
  ops: { uuid: string; name: string; level: number }[]
  banned: { uuid: string; name: string; reason?: string; created?: string }[]
}
type Action = 'whitelist-add' | 'whitelist-remove' | 'op' | 'deop' | 'ban' | 'pardon' | 'kick'

const { server, status } = useServerContext()
const toast = useToast()
const url = computed(() => `/api/servers/${server.value?.name}/players`)
const { data, refresh } = await useFetch<PlayersView>(url)

// Who's online changes constantly; refresh while this tab is open and the server runs.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (status.value === 'active') refresh()
  }, 5000)
})
onBeforeUnmount(() => clearInterval(timer))
watch(status, () => refresh())

const busy = ref<string | null>(null)
async function act(action: Action, player: string, reason?: string) {
  busy.value = `${action}:${player}`
  try {
    const { reply } = await $fetch<{ reply: string }>(url.value as string, {
      method: 'POST',
      body: { action, player, reason },
    })
    toast.add({ title: reply || 'Done', color: 'success' })
    await refresh()
    return true
  } catch (err) {
    toast.add({ title: "That didn't work", description: errorMessage(err), color: 'error' })
    return false
  } finally {
    busy.value = null
  }
}

const NAME = /^[A-Za-z0-9_]{1,16}$/
const inputs = reactive({ whitelist: '', ops: '', banned: '', reason: '' })
async function add(list: 'whitelist' | 'ops' | 'banned') {
  const player = inputs[list].trim()
  if (!NAME.test(player)) {
    toast.add({ title: "That isn't a valid Minecraft username.", color: 'warning' })
    return
  }
  const action: Action = list === 'whitelist' ? 'whitelist-add' : list === 'ops' ? 'op' : 'ban'
  if (await act(action, player, list === 'banned' ? inputs.reason : undefined)) {
    inputs[list] = ''
    if (list === 'banned') inputs.reason = ''
  }
}

const isOp = (n: string) => data.value?.ops.some((o) => o.name.toLowerCase() === n.toLowerCase())
</script>

<template>
  <div v-if="data" class="mx-auto w-full max-w-4xl space-y-6">
    <UAlert
      v-if="!data.running"
      color="neutral"
      variant="subtle"
      icon="i-lucide-info"
      title="The server is stopped"
      description="Changes are saved to its files and take effect when it starts."
    />
    <UAlert
      v-if="!data.onlineMode"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Online mode is off"
      description="Accounts aren't checked with Mojang, so anyone can join with any name. The whitelist matters more than usual."
    />

    <section v-if="data.running" class="rounded-lg border border-default p-5">
      <div class="flex items-baseline justify-between">
        <h2 class="font-display text-lg tracking-wide uppercase">Online now</h2>
        <span v-if="data.online" class="text-sm text-muted"
          >{{ data.online.count }} of {{ data.online.max }}</span
        >
      </div>
      <p v-if="!data.online || data.online.names.length === 0" class="mt-3 text-sm text-muted">
        Nobody's playing right now.
      </p>
      <ul v-else class="mt-3 divide-y divide-default">
        <li v-for="p in data.online.names" :key="p" class="flex items-center gap-3 py-2">
          <UAvatar :alt="p" size="sm" class="rounded-sm" />
          <span class="flex-1 font-medium">{{ p }}</span>
          <UBadge v-if="isOp(p)" label="Operator" size="sm" variant="subtle" />
          <UButton
            v-else
            label="Make operator"
            size="xs"
            variant="ghost"
            color="neutral"
            :loading="busy === `op:${p}`"
            @click="act('op', p)"
          />
          <UButton
            label="Kick"
            size="xs"
            variant="ghost"
            color="error"
            :loading="busy === `kick:${p}`"
            @click="act('kick', p)"
          />
        </li>
      </ul>
    </section>

    <div class="grid gap-6 lg:grid-cols-3">
      <section class="rounded-lg border border-default p-5">
        <h2 class="font-display text-lg tracking-wide uppercase">Whitelist</h2>
        <p class="mt-1 text-sm text-muted">
          {{ data.whitelistEnabled ? 'On: only these players can join.' : 'Off: anyone can join.' }}
          <NuxtLink :to="`/servers/${server?.name}/settings`" class="text-primary">Change</NuxtLink>
        </p>
        <form class="mt-3 flex gap-2" @submit.prevent="add('whitelist')">
          <UInput
            v-model="inputs.whitelist"
            placeholder="Username"
            class="flex-1"
            aria-label="Username to whitelist"
          />
          <UButton
            type="submit"
            icon="i-lucide-plus"
            aria-label="Add to whitelist"
            :loading="busy?.startsWith('whitelist-add')"
          />
        </form>
        <ul class="mt-3 space-y-1">
          <li v-for="p in data.whitelist" :key="p.uuid" class="flex items-center gap-2 text-sm">
            <UAvatar :alt="p.name" size="xs" class="rounded-sm" />
            <span class="flex-1">{{ p.name }}</span>
            <UButton
              icon="i-lucide-x"
              size="xs"
              variant="ghost"
              color="neutral"
              :aria-label="`Remove ${p.name}`"
              @click="act('whitelist-remove', p.name)"
            />
          </li>
          <li v-if="data.whitelist.length === 0" class="text-sm text-muted">Nobody yet.</li>
        </ul>
      </section>

      <section class="rounded-lg border border-default p-5">
        <h2 class="font-display text-lg tracking-wide uppercase">Operators</h2>
        <p class="mt-1 text-sm text-muted">Can run commands in game.</p>
        <form class="mt-3 flex gap-2" @submit.prevent="add('ops')">
          <UInput
            v-model="inputs.ops"
            placeholder="Username"
            class="flex-1"
            aria-label="Username to make operator"
          />
          <UButton
            type="submit"
            icon="i-lucide-plus"
            aria-label="Make operator"
            :loading="busy?.startsWith('op:')"
          />
        </form>
        <ul class="mt-3 space-y-1">
          <li v-for="p in data.ops" :key="p.uuid" class="flex items-center gap-2 text-sm">
            <UAvatar :alt="p.name" size="xs" class="rounded-sm" />
            <span class="flex-1">{{ p.name }}</span>
            <UButton
              icon="i-lucide-x"
              size="xs"
              variant="ghost"
              color="neutral"
              :aria-label="`Remove operator ${p.name}`"
              @click="act('deop', p.name)"
            />
          </li>
          <li v-if="data.ops.length === 0" class="text-sm text-muted">Nobody yet.</li>
        </ul>
      </section>

      <section class="rounded-lg border border-default p-5">
        <h2 class="font-display text-lg tracking-wide uppercase">Banned</h2>
        <p class="mt-1 text-sm text-muted">Can't join at all.</p>
        <form class="mt-3 space-y-2" @submit.prevent="add('banned')">
          <div class="flex gap-2">
            <UInput
              v-model="inputs.banned"
              placeholder="Username"
              class="flex-1"
              aria-label="Username to ban"
            />
            <UButton
              type="submit"
              icon="i-lucide-ban"
              color="error"
              variant="soft"
              aria-label="Ban"
              :loading="busy?.startsWith('ban:')"
            />
          </div>
          <UInput
            v-if="inputs.banned"
            v-model="inputs.reason"
            placeholder="Reason (optional)"
            class="w-full"
            size="sm"
          />
        </form>
        <ul class="mt-3 space-y-1">
          <li v-for="p in data.banned" :key="p.uuid" class="flex items-start gap-2 text-sm">
            <UAvatar :alt="p.name" size="xs" class="mt-0.5 rounded-sm" />
            <span class="flex-1">
              {{ p.name }}
              <span v-if="p.reason" class="block text-xs text-muted">{{ p.reason }}</span>
            </span>
            <UButton
              label="Unban"
              size="xs"
              variant="ghost"
              color="neutral"
              @click="act('pardon', p.name)"
            />
          </li>
          <li v-if="data.banned.length === 0" class="text-sm text-muted">Nobody.</li>
        </ul>
      </section>
    </div>
  </div>
</template>
