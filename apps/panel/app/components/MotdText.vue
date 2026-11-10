<script setup lang="ts">
import type { MotdLine, MotdStyle } from '~~/shared/utils/motd'

/**
 * One line of an MOTD in the game's colours. With `exact`, every character takes the width
 * the game gives it (in `--motd-px` units), so wrapping and widths match the multiplayer list
 * even though the font is monospaced. Obfuscated text keeps changing, as in the game.
 */
const props = defineProps<{ line: MotdLine; exact?: boolean }>()

const tick = ref(0)
const animated = computed(() => props.line.some((r) => r.style.obfuscated))
let timer: ReturnType<typeof setInterval> | undefined
watchEffect((onCleanup) => {
  if (!animated.value || import.meta.server) return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    timer = setInterval(() => tick.value++, 1000)
  } else {
    timer = setInterval(() => tick.value++, 60)
  }
  onCleanup(() => clearInterval(timer))
})

const runs = computed(() => {
  void tick.value
  return props.line.map((run) => ({
    ...run,
    shown: run.style.obfuscated ? obfuscate(run.text) : run.text,
  }))
})

function runStyle(style: MotdStyle) {
  const decoration = [style.underlined && 'underline', style.strikethrough && 'line-through']
    .filter(Boolean)
    .join(' ')
  return {
    color: style.colour ? colourHex(style.colour) : undefined,
    fontWeight: style.bold ? 700 : undefined,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecoration: decoration || undefined,
  }
}
</script>

<template>
  <span class="motd-line">
    <span
      v-for="(run, i) in runs"
      :key="i"
      :style="runStyle(run.style)"
      :aria-hidden="run.style.obfuscated || undefined"
    >
      <template v-if="exact">
        <span
          v-for="(ch, j) in [...run.shown]"
          :key="j"
          class="motd-cell"
          :class="glyphAdvance(ch) < 6 && 'motd-narrow'"
          :style="{ width: `calc(var(--motd-px) * ${glyphAdvance(ch, run.style.bold)})` }"
          >{{ ch === ' ' ? '\u00a0' : ch }}</span
        >
      </template>
      <template v-else>{{ run.shown }}</template>
    </span>
  </span>
</template>

<style scoped>
.motd-line {
  white-space: pre;
}
.motd-cell {
  display: inline-flex;
  justify-content: center;
  overflow: visible;
  text-decoration: inherit;
}
/* Monocraft draws every glyph six pixels wide; the game's narrow ones are trimmed to fit. */
.motd-narrow {
  overflow: clip;
  overflow-clip-margin: calc(var(--motd-px) * 0.5);
}
</style>
