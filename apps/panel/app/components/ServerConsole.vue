<script setup lang="ts">
const props = defineProps<{ server: string; running: boolean }>()
const can = useCan()
const canSend = computed(() => can('console.command', props.server))

type ConsoleMessage = { type: 'snapshot' | 'lines'; lines: string[] }
const MAX_LINES = 1000

const lines = ref<string[]>([])
const scroller = ref<HTMLElement | null>(null)
const pinned = ref(true)

useTopic<ConsoleMessage>(
  () => `console:${props.server}`,
  (m) => {
    lines.value = m.type === 'snapshot' ? m.lines : [...lines.value, ...m.lines].slice(-MAX_LINES)
    if (pinned.value) nextTick(scrollToEnd)
  },
)

function scrollToEnd() {
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}
function jumpToLatest() {
  pinned.value = true
  scrollToEnd()
}
function onScroll() {
  const el = scroller.value
  if (el) pinned.value = el.scrollHeight - el.scrollTop - el.clientHeight < 24
}

// Per-server command history, kept in this browser only.
const historyKey = computed(() => `flytower:history:${props.server}`)
const history = ref<string[]>([])
let cursor = -1
onMounted(() => {
  try {
    history.value = JSON.parse(localStorage.getItem(historyKey.value) ?? '[]')
  } catch {
    history.value = []
  }
})
function remember(command: string) {
  history.value = [command, ...history.value.filter((c) => c !== command)].slice(0, 50)
  try {
    localStorage.setItem(historyKey.value, JSON.stringify(history.value))
  } catch {
    // Private windows can refuse storage; history then lasts for this page only.
  }
}

const input = ref('')
const sending = ref(false)
const toast = useToast()

function browse(step: 1 | -1) {
  if (history.value.length === 0) return
  cursor = Math.max(-1, Math.min(history.value.length - 1, cursor + step))
  input.value = cursor === -1 ? '' : history.value[cursor]!
}

async function send() {
  const command = input.value.trim()
  if (!command || sending.value) return
  sending.value = true
  try {
    await $fetch(`/api/servers/${props.server}/command`, { method: 'POST', body: { command } })
    remember(command.replace(/^\//, ''))
    input.value = ''
    cursor = -1
    pinned.value = true
    nextTick(scrollToEnd)
  } catch (err) {
    toast.add({
      title: 'Command failed',
      description: (err as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error',
    })
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <section
    class="flex min-h-0 flex-col overflow-hidden rounded-lg border border-default bg-[#0b0e14]"
  >
    <div class="relative min-h-0 flex-1">
      <div
        ref="scroller"
        class="absolute inset-0 overflow-y-auto px-4 py-3 font-mono text-[13px] leading-relaxed"
        role="log"
        aria-live="polite"
        aria-label="Server console"
        @scroll="onScroll"
      >
        <p v-if="lines.length === 0" class="text-muted">
          {{
            running
              ? 'Waiting for the server to log something…'
              : 'No log yet. Start the server to see its output.'
          }}
        </p>
        <div
          v-for="(line, i) in lines"
          :key="i"
          class="break-words whitespace-pre-wrap"
          :class="logTone(line)"
        >
          {{ line }}
        </div>
      </div>
      <UButton
        v-if="!pinned"
        class="absolute right-4 bottom-3"
        size="xs"
        color="neutral"
        variant="solid"
        icon="i-lucide-arrow-down"
        label="Latest"
        @click="jumpToLatest"
      />
    </div>
    <form
      v-if="canSend"
      class="flex items-center gap-2 border-t border-default p-2"
      @submit.prevent="send"
    >
      <span class="pl-2 font-mono text-primary" aria-hidden="true">&gt;</span>
      <UInput
        v-model="input"
        variant="none"
        class="flex-1 font-mono"
        :placeholder="running ? 'Type a command, e.g. list' : 'Start the server to send commands'"
        :disabled="!running"
        aria-label="Command"
        autocomplete="off"
        @keydown.up.prevent="browse(1)"
        @keydown.down.prevent="browse(-1)"
      />
      <UButton
        type="submit"
        icon="i-lucide-corner-down-left"
        size="sm"
        variant="ghost"
        :loading="sending"
        :disabled="!running || !input.trim()"
        aria-label="Send command"
      />
    </form>
  </section>
</template>
