<script setup lang="ts">
/**
 * The server's entry in Minecraft's multiplayer list, drawn at the game's own sizes (a row
 * 305 pixels wide) and scaled to fit: icon, name, player count and the MOTD's two lines.
 */
const props = defineProps<{
  motd: string
  name: string
  maxPlayers?: number
  online?: number
  /** The server's 64×64 icon, if it has one. */
  icon?: string | null
}>()

const ROW_WIDTH = 305

const box = ref<HTMLElement>()
const width = ref(ROW_WIDTH * 2)
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(([e]) => (width.value = e!.contentRect.width))
  if (box.value) observer.observe(box.value)
})
onBeforeUnmount(() => observer?.disconnect())
// Two screen pixels to the game's pixel when there's room, as at GUI scale 2.
const px = computed(() => Math.max(0.75, Math.min(2, width.value / ROW_WIDTH)))

const layout = computed(() => layoutMotd(props.motd))
const nameLine = computed(() => parseMotd(props.name)[0] ?? [])
const count = computed(() => [String(props.online ?? 0), String(props.maxPlayers ?? 20)])
const countWidth = computed(
  () => [...`${count.value[0]}/${count.value[1]}`].reduce((w, c) => w + glyphAdvance(c), 0) - 1,
)

const warnings = computed(() => {
  const out: string[] = []
  const l = layout.value
  for (const i of l.wrapped) {
    const over = l.widths[i]! - MOTD_LINE_WIDTH
    out.push(
      `Line ${i + 1} is ${over} ${over === 1 ? 'pixel' : 'pixels'} too wide, so the game wraps it onto the next line.`,
    )
  }
  if (l.hidden) out.push(`The list only shows two lines, so “${l.hidden}” is cut off.`)
  return out
})
</script>

<template>
  <div>
    <div ref="box" class="w-full overflow-hidden rounded-md">
      <div
        class="motd-row"
        :style="{ '--motd-px': `${px}px`, width: `${ROW_WIDTH * px}px` }"
        role="img"
        :aria-label="`Preview of the multiplayer list: ${name}, ${motdPlainText(motd).replace('\n', ' / ')}`"
        data-e2e="motd-preview"
      >
        <div class="motd-icon">
          <img v-if="icon" :src="icon" alt="" class="size-full [image-rendering:pixelated]" />
          <UIcon v-else name="i-lucide-box" class="size-1/2 text-[#9a9a9a]" />
        </div>
        <div class="motd-name"><MotdText :line="nameLine" exact /></div>
        <div class="motd-count" :style="{ width: `calc(var(--motd-px) * ${countWidth + 1})` }">
          <MotdText
            :line="[
              { text: count[0]!, style: { ...PLAIN, colour: '7' } },
              { text: '/', style: { ...PLAIN, colour: '8' } },
              { text: count[1]!, style: { ...PLAIN, colour: '7' } },
            ]"
            exact
          />
        </div>
        <div class="motd-ping" aria-hidden="true">
          <span
            v-for="h in [2, 3, 4, 5, 7]"
            :key="h"
            :style="{ height: `calc(var(--motd-px) * ${h})` }"
          />
        </div>
        <div
          v-for="(line, i) in layout.visible"
          :key="i"
          class="motd-text"
          :style="{ top: `calc(var(--motd-px) * ${12 + 9 * i})` }"
        >
          <MotdText :line="line" exact />
        </div>
      </div>
    </div>
    <ul v-if="warnings.length" class="mt-2 space-y-1 text-sm text-warning" data-e2e="motd-warnings">
      <li v-for="w in warnings" :key="w" class="flex gap-1.5">
        <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" />
        <span>{{ w }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.motd-row {
  position: relative;
  height: calc(var(--motd-px) * 36);
  max-width: 100%;
  background: #121212;
  color: #808080;
  font-family: 'Monocraft', var(--font-mono);
  font-size: calc(var(--motd-px) * 9);
  line-height: calc(var(--motd-px) * 9);
  font-synthesis: weight style;
  -webkit-font-smoothing: none;
  user-select: none;
}
.motd-icon {
  position: absolute;
  left: calc(var(--motd-px) * 2);
  top: calc(var(--motd-px) * 2);
  width: calc(var(--motd-px) * 32);
  height: calc(var(--motd-px) * 32);
  display: grid;
  place-items: center;
  background: #2b2b2b;
}
.motd-name,
.motd-text,
.motd-count {
  position: absolute;
  left: calc(var(--motd-px) * 37);
  white-space: nowrap;
}
.motd-name {
  top: calc(var(--motd-px) * 2);
  color: #ffffff;
}
.motd-count {
  left: auto;
  right: calc(var(--motd-px) * 18);
  top: calc(var(--motd-px) * 2);
}
.motd-ping {
  position: absolute;
  right: calc(var(--motd-px) * 4);
  top: calc(var(--motd-px) * 2);
  height: calc(var(--motd-px) * 8);
  display: flex;
  align-items: flex-end;
  gap: calc(var(--motd-px) * 1);
}
.motd-ping span {
  width: calc(var(--motd-px) * 1);
  background: #55ff55;
}
</style>
