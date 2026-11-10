<script setup lang="ts">
import type { ColourCode, MotdFormat, MotdLine, MotdStyle } from '~~/shared/utils/motd'

/**
 * Edits an MOTD as formatted text, or as raw `§` codes with **Show codes**. The value is the
 * same `§` string the spec holds; it only changes when someone edits, so codes written by
 * hand are kept as they are until then.
 *
 * It's one two-row box (Enter starts the second line): a native textarea over a styled copy
 * of its text, so typing, selection, undo and phone keyboards behave as usual.
 */
const model = defineModel<string>({ required: true })
defineProps<{ name: string; maxPlayers?: number }>()

interface Cell {
  ch: string
  style: MotdStyle
}

const showCodes = ref(false)
/** Every character of the text, line breaks included, each with its own style. */
const cells = ref<Cell[]>([])
const raw = ref('')
let emitted: string | null = null

function load(text: string) {
  cells.value = parseMotd(text).flatMap((line, i) => [
    ...(i ? [{ ch: '\n', style: PLAIN }] : []),
    ...line.flatMap((r) => [...r.text].map((ch) => ({ ch, style: r.style }))),
  ])
  raw.value = text
}
watch(model, (v) => v !== emitted && load(v ?? ''), { immediate: true })
watch(showCodes, () => {
  load(model.value ?? '')
  pending.value = null
})

function emit(value: string) {
  emitted = value
  model.value = value
}
const toRuns = (line: Cell[]): MotdLine => {
  const runs: MotdLine = []
  for (const { ch, style } of line) {
    const last = runs.at(-1)
    if (last && sameStyle(last.style, style)) last.text += ch
    else runs.push({ text: ch, style })
  }
  return runs
}
function splitLines(list: Cell[]): Cell[][] {
  const out: Cell[][] = [[]]
  for (const c of list) {
    if (c.ch === '\n') out.push([])
    else out.at(-1)!.push(c)
  }
  return out
}
const lines = computed(() => splitLines(cells.value))
const emitRich = () => emit(serialiseMotd(lines.value.map(toRuns)))
const emitRaw = () => emit(raw.value.replace(/\n+$/, ''))

const plain = computed(() => cells.value.map((c) => c.ch).join(''))
const newlines = (s: string) => s.split('\n').length - 1
/** Two lines, unless the MOTD already had more (written by hand); never more than that. */
const maxBreaks = () => Math.max(1, newlines(showCodes.value ? raw.value : plain.value))

// Selection -------------------------------------------------------------------------------

const box = ref<HTMLTextAreaElement>()
/** The selection, in characters (not UTF-16 units). */
const sel = reactive({ start: 0, end: 0 })
/** A style picked with nothing selected, for whatever is typed next at that spot. */
const pending = ref<{ pos: number; style: MotdStyle } | null>(null)
const scroll = reactive({ left: 0, top: 0 })

const toChars = (s: string, units: number) => [...s.slice(0, units)].length
const toUnits = (s: string, chars: number) => [...s].slice(0, chars).join('').length

function track() {
  const el = box.value
  if (!el) return
  const start = toChars(el.value, el.selectionStart ?? 0)
  const end = toChars(el.value, el.selectionEnd ?? 0)
  if (pending.value && (pending.value.pos !== start || end !== start)) pending.value = null
  Object.assign(sel, { start, end })
  Object.assign(scroll, { left: el.scrollLeft, top: el.scrollTop })
}
function onSelectionChange() {
  if (box.value && box.value === document.activeElement) track()
}
onMounted(() => document.addEventListener('selectionchange', onSelectionChange))
onBeforeUnmount(() => document.removeEventListener('selectionchange', onSelectionChange))

function typingStyle(pos: number): MotdStyle {
  const p = pending.value
  if (p && p.pos === pos) return p.style
  const list = cells.value
  // The style of the character before, on the same line; at a line's start, the one after.
  const before = list[pos - 1]
  if (before && before.ch !== '\n') return before.style
  const after = list[pos]
  return after && after.ch !== '\n' ? after.style : PLAIN
}

function restore(start = sel.start, end = sel.end) {
  nextTick(() => {
    const el = box.value
    if (!el) return
    el.focus()
    el.setSelectionRange(toUnits(el.value, start), toUnits(el.value, end))
    Object.assign(sel, { start, end })
  })
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  const el = e.target as HTMLTextAreaElement
  const selected = el.value.slice(el.selectionStart, el.selectionEnd)
  if (newlines(el.value) - newlines(selected) >= maxBreaks()) e.preventDefault()
}

// Editing ---------------------------------------------------------------------------------

function onRichInput(e: Event) {
  const el = e.target as HTMLTextAreaElement
  const old = cells.value
  const next = [...el.value]
  let p = 0
  while (p < old.length && p < next.length && old[p]!.ch === next[p]) p++
  let s = 0
  while (s < old.length - p && s < next.length - p && old.at(-1 - s)!.ch === next.at(-1 - s)) s++
  let typed = next.slice(p, next.length - s).join('')
  // Never more lines than allowed: extra breaks (from a paste) become spaces.
  const kept =
    newlines(plain.value) -
    newlines(
      old
        .slice(p, old.length - s)
        .map((c) => c.ch)
        .join(''),
    )
  let room = maxBreaks() - kept
  typed = typed.replace(/\n/g, () => (room-- > 0 ? '\n' : ' '))
  const base = typingStyle(p)
  // Pasted `§` text keeps its formatting; everything else takes the style at the cursor.
  const codeAt = typed.indexOf('§')
  const inserted: Cell[] = [...(codeAt < 0 ? typed : typed.slice(0, codeAt))].map((ch) => ({
    ch,
    style: ch === '\n' ? PLAIN : base,
  }))
  if (codeAt >= 0) {
    parseMotd(typed.slice(codeAt)).forEach((line, i) => {
      if (i) inserted.push({ ch: '\n', style: PLAIN })
      for (const run of line) for (const ch of run.text) inserted.push({ ch, style: run.style })
    })
  }
  cells.value = [...old.slice(0, p), ...inserted, ...old.slice(old.length - s)]
  pending.value = null
  if (el.value !== plain.value) {
    el.value = plain.value
    const caret = toUnits(plain.value, p + inserted.length)
    el.setSelectionRange(caret, caret)
  }
  emitRich()
  track()
}

function onRawInput(e: Event) {
  raw.value = (e.target as HTMLTextAreaElement).value
  emitRaw()
  track()
}

function restyle(change: (s: MotdStyle) => MotdStyle) {
  const { start, end } = sel
  if (start === end) {
    pending.value = { pos: start, style: change(typingStyle(start)) }
    restore()
    return
  }
  cells.value = cells.value.map((c, k) =>
    k >= start && k < end && c.ch !== '\n' ? { ch: c.ch, style: change(c.style) } : c,
  )
  emitRich()
  restore()
}

function insertCode(code: string) {
  const { start, end } = sel
  const chars = [...raw.value]
  chars.splice(start, end - start, '§', code)
  raw.value = chars.join('')
  emitRaw()
  restore(start + 2, start + 2)
}

const selected = computed(() =>
  sel.start < sel.end ? cells.value.slice(sel.start, sel.end).filter((c) => c.ch !== '\n') : null,
)

function toggle(format: MotdFormat) {
  if (showCodes.value) return insertCode(MOTD_FORMATS.find((f) => f.format === format)!.code)
  const on = !isOn(format)
  restyle((s) => ({ ...s, [format]: on }))
}
function isOn(format: MotdFormat) {
  if (showCodes.value) return false
  const list = selected.value
  return list?.length ? list.every((c) => c.style[format]) : typingStyle(sel.start)[format]
}

const colourOpen = ref(false)
function setColour(code: ColourCode | null) {
  colourOpen.value = false
  if (showCodes.value) return insertCode(code ?? 'r')
  restyle((s) => ({ ...s, colour: code }))
}
const currentColour = computed<ColourCode | null | undefined>(() => {
  if (showCodes.value) return undefined
  const list = selected.value
  if (!list?.length) return typingStyle(sel.start).colour
  const first = list[0]!.style.colour
  return list.every((c) => c.style.colour === first) ? first : undefined
})

function reset() {
  if (showCodes.value) return insertCode('r')
  restyle(() => ({ ...PLAIN }))
}

const FORMAT_ICONS: Record<MotdFormat, string> = {
  bold: 'i-lucide-bold',
  italic: 'i-lucide-italic',
  underlined: 'i-lucide-underline',
  strikethrough: 'i-lucide-strikethrough',
  obfuscated: 'i-lucide-sparkles',
}
const TOOLBAR_FORMATS: MotdFormat[] = [
  'bold',
  'italic',
  'underlined',
  'strikethrough',
  'obfuscated',
]
const formatLabel = (f: MotdFormat) => MOTD_FORMATS.find((x) => x.format === f)!.label

function cellStyle(style: MotdStyle) {
  const decoration = [style.underlined && 'underline', style.strikethrough && 'line-through']
    .filter(Boolean)
    .join(' ')
  return {
    color: style.colour ? colourHex(style.colour) : MOTD_DEFAULT_HEX,
    fontWeight: style.bold ? 600 : undefined,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecoration: decoration || undefined,
  }
}
</script>

<template>
  <div class="space-y-3" data-e2e="motd-editor">
    <div
      class="flex flex-wrap items-center gap-1 rounded-md border border-default bg-elevated p-1"
      role="toolbar"
      aria-label="Formatting"
    >
      <UPopover v-model:open="colourOpen" :content="{ align: 'start' }">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          :aria-label="showCodes ? 'Insert a colour code' : 'Colour'"
          title="Colour"
          @mousedown.prevent
        >
          <span
            class="size-4 rounded-sm border border-white/30"
            :style="{
              background:
                currentColour === undefined
                  ? 'conic-gradient(#FF5555, #FFFF55, #55FF55, #55FFFF, #5555FF, #FF55FF, #FF5555)'
                  : currentColour
                    ? colourHex(currentColour)
                    : MOTD_DEFAULT_HEX,
            }"
          />
          <UIcon name="i-lucide-chevron-down" class="size-3.5" />
        </UButton>
        <template #content>
          <div class="w-56 p-2" data-e2e="motd-colours">
            <div class="grid grid-cols-8 gap-1">
              <button
                v-for="c in MOTD_COLOURS"
                :key="c.code"
                type="button"
                class="aspect-square rounded-sm border border-white/20 outline-offset-1 focus-visible:outline-2 focus-visible:outline-primary"
                :class="currentColour === c.code && 'ring-2 ring-primary'"
                :style="{ background: c.hex }"
                :title="`${c.label} (§${c.code})`"
                :aria-label="c.label"
                @click="setColour(c.code)"
              />
            </div>
            <UButton
              block
              class="mt-2"
              size="sm"
              color="neutral"
              variant="soft"
              :label="showCodes ? 'Reset (§r)' : 'Default colour'"
              @click="setColour(null)"
            />
          </div>
        </template>
      </UPopover>
      <UButton
        v-for="f in TOOLBAR_FORMATS"
        :key="f"
        :icon="FORMAT_ICONS[f]"
        size="sm"
        :color="isOn(f) ? 'primary' : 'neutral'"
        :variant="isOn(f) ? 'soft' : 'ghost'"
        :aria-label="formatLabel(f)"
        :aria-pressed="showCodes ? undefined : isOn(f)"
        :title="formatLabel(f)"
        @mousedown.prevent
        @click="toggle(f)"
      />
      <UButton
        icon="i-lucide-remove-formatting"
        size="sm"
        color="neutral"
        variant="ghost"
        aria-label="Clear formatting"
        title="Clear formatting"
        @mousedown.prevent
        @click="reset"
      />
      <USwitch v-model="showCodes" label="Show codes" size="sm" class="ml-auto px-2" />
    </div>

    <div class="motd-field" :class="!showCodes && 'motd-field-rich'">
      <div v-if="!showCodes" class="motd-mirror" aria-hidden="true">
        <div :style="{ transform: `translate(-${scroll.left}px, -${scroll.top}px)` }">
          <div v-for="(line, i) in lines" :key="i" class="motd-mirror-line">
            <span
              v-for="(run, k) in toRuns(line)"
              :key="k"
              :style="cellStyle(run.style)"
              :class="run.style.obfuscated && 'motd-obfuscated'"
              >{{ run.text }}</span
            >
          </div>
        </div>
      </div>
      <textarea
        ref="box"
        :value="showCodes ? raw : plain"
        aria-label="Message of the day, two lines"
        placeholder="First line, then Enter for the second"
        :rows="Math.max(2, lines.length)"
        wrap="off"
        class="motd-input"
        :class="showCodes ? 'motd-raw' : 'motd-rich'"
        spellcheck="false"
        autocomplete="off"
        data-e2e="motd-text"
        @input="showCodes ? onRawInput($event) : onRichInput($event)"
        @keydown="onKeydown"
        @focus="track"
        @select="track"
        @keyup="track"
        @click="track"
        @scroll="track"
      />
    </div>

    <MotdPreview :motd="model" :name="name" :max-players="maxPlayers" />
  </div>
</template>

<style scoped>
.motd-field {
  position: relative;
}
.motd-input,
.motd-mirror {
  width: 100%;
  padding: 0.5rem 0.75rem;
  font-family: var(--font-mono);
  font-size: 0.875rem;
  line-height: 1.25rem;
  border-radius: 0.375rem;
  white-space: pre;
}
.motd-mirror {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  border: 1px solid transparent;
}
.motd-mirror-line {
  min-height: 1.25rem;
}
.motd-input {
  position: relative;
  display: block;
  border: 1px solid var(--ui-border-accented);
  background: #121212;
  outline: none;
  resize: none;
  overflow-x: auto;
  overflow-y: hidden;
}
.motd-input:focus-visible {
  border-color: var(--ui-primary);
  box-shadow: 0 0 0 1px var(--ui-primary);
}
.motd-rich {
  color: transparent;
  caret-color: #ffffff;
  background: transparent;
}
.motd-field-rich {
  background: #121212;
  border-radius: 0.375rem;
}
.motd-raw {
  color: #d3dae5;
}
.motd-input::placeholder {
  color: #6b7280;
}
.motd-rich::selection {
  background: rgb(242 169 59 / 0.35);
  color: transparent;
}
.motd-obfuscated {
  background: repeating-linear-gradient(135deg, rgb(255 255 255 / 0.12) 0 3px, transparent 3px 6px);
}
</style>
