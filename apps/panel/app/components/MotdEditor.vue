<script setup lang="ts">
import type { ColourCode, MotdFormat, MotdLine, MotdStyle } from '~~/shared/utils/motd'

/**
 * Edits an MOTD as formatted text, or as raw `§` codes with **Show codes**. The value is the
 * same `§` string the spec holds; it only changes when someone edits, so codes written by
 * hand are kept as they are until then.
 *
 * Each line is a native text input over a styled copy of its text, so typing, selection,
 * undo and phone keyboards behave as usual.
 */
const model = defineModel<string>({ required: true })
defineProps<{ name: string; maxPlayers?: number }>()

interface Cell {
  ch: string
  style: MotdStyle
}

const LINES = ['First line', 'Second line']

const showCodes = ref(false)
const lines = ref<Cell[][]>([[], []])
const raw = ref<string[]>(['', ''])
let emitted: string | null = null

function load(text: string) {
  const parsed = parseMotd(text).map((l) =>
    l.flatMap((r) => [...r.text].map((ch) => ({ ch, style: r.style }))),
  )
  while (parsed.length < 2) parsed.push([])
  lines.value = parsed
  const r = text.split('\n')
  while (r.length < 2) r.push('')
  raw.value = r
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
const toRuns = (cells: Cell[]): MotdLine => {
  const runs: MotdLine = []
  for (const { ch, style } of cells) {
    const last = runs.at(-1)
    if (last && sameStyle(last.style, style)) last.text += ch
    else runs.push({ text: ch, style })
  }
  return runs
}
const emitRich = () => emit(serialiseMotd(lines.value.map(toRuns)))
function emitRaw() {
  const r = [...raw.value]
  while (r.length > 1 && r.at(-1) === '') r.pop()
  emit(r.join('\n'))
}

const plain = (i: number) => lines.value[i]!.map((c) => c.ch).join('')

// Selection -------------------------------------------------------------------------------

const inputs = ref<HTMLInputElement[]>([])
const setInput = (i: number) => (el: unknown) => {
  if (el) inputs.value[i] = el as HTMLInputElement
}
/** Where the selection was in the line last focused, in characters (not UTF-16 units). */
const sel = reactive({ line: 0, start: 0, end: 0 })
/** A style picked with nothing selected, for whatever is typed next at that spot. */
const pending = ref<{ line: number; pos: number; style: MotdStyle } | null>(null)
const scroll = ref<number[]>([0, 0])

const toChars = (s: string, units: number) => [...s.slice(0, units)].length
const toUnits = (cells: { ch: string }[], chars: number) =>
  cells.slice(0, chars).reduce((n, c) => n + c.ch.length, 0)

function track(i: number) {
  const el = inputs.value[i]
  if (!el) return
  const start = toChars(el.value, el.selectionStart ?? 0)
  const end = toChars(el.value, el.selectionEnd ?? 0)
  if (sel.line !== i || sel.start !== start || sel.end !== end) {
    if (
      pending.value &&
      (pending.value.line !== i || pending.value.pos !== start || end !== start)
    ) {
      pending.value = null
    }
  }
  Object.assign(sel, { line: i, start, end })
  scroll.value[i] = el.scrollLeft
}
function onSelectionChange() {
  const i = inputs.value.findIndex((el) => el === document.activeElement)
  if (i >= 0) track(i)
}
onMounted(() => document.addEventListener('selectionchange', onSelectionChange))
onBeforeUnmount(() => document.removeEventListener('selectionchange', onSelectionChange))

function typingStyle(line: number, pos: number): MotdStyle {
  const p = pending.value
  if (p && p.line === line && p.pos === pos) return p.style
  const cells = lines.value[line]!
  return cells[pos - 1]?.style ?? cells[0]?.style ?? PLAIN
}

function restore(start = sel.start, end = sel.end) {
  nextTick(() => {
    const el = inputs.value[sel.line]
    if (!el) return
    el.focus()
    const cells = showCodes.value
      ? [...raw.value[sel.line]!].map((ch) => ({ ch }))
      : lines.value[sel.line]!
    el.setSelectionRange(toUnits(cells, start), toUnits(cells, end))
    Object.assign(sel, { start, end })
  })
}

// Editing ---------------------------------------------------------------------------------

function onRichInput(i: number, e: Event) {
  const el = e.target as HTMLInputElement
  const old = lines.value[i]!
  const next = [...el.value]
  let p = 0
  while (p < old.length && p < next.length && old[p]!.ch === next[p]) p++
  let s = 0
  while (s < old.length - p && s < next.length - p && old.at(-1 - s)!.ch === next.at(-1 - s)) s++
  const typed = next.slice(p, next.length - s).join('')
  const base = typingStyle(i, p)
  // Pasted `§` text keeps its formatting; everything else takes the style at the cursor.
  const codeAt = typed.indexOf('§')
  const inserted: Cell[] = [...(codeAt < 0 ? typed : typed.slice(0, codeAt))].map((ch) => ({
    ch,
    style: base,
  }))
  if (codeAt >= 0) {
    for (const run of parseMotd(typed.slice(codeAt).replace(/\n/g, ' ')).flat()) {
      for (const ch of run.text) inserted.push({ ch, style: run.style })
    }
  }
  const cells = [...old.slice(0, p), ...inserted, ...old.slice(old.length - s)]
  lines.value[i] = cells
  pending.value = null
  const text = cells.map((c) => c.ch).join('')
  if (el.value !== text) {
    el.value = text
    const caret = toUnits(cells, p + inserted.length)
    el.setSelectionRange(caret, caret)
  }
  emitRich()
  track(i)
}

function onRawInput(i: number, e: Event) {
  raw.value[i] = (e.target as HTMLInputElement).value
  emitRaw()
  track(i)
}

function restyle(change: (s: MotdStyle) => MotdStyle) {
  const { line, start, end } = sel
  if (start === end) {
    pending.value = { line, pos: start, style: change(typingStyle(line, start)) }
    restore()
    return
  }
  lines.value[line] = lines.value[line]!.map((c, k) =>
    k >= start && k < end ? { ch: c.ch, style: change(c.style) } : c,
  )
  emitRich()
  restore()
}

function insertCode(code: string) {
  const { line, start, end } = sel
  const chars = [...raw.value[line]!]
  chars.splice(start, end - start, '§', code)
  raw.value[line] = chars.join('')
  emitRaw()
  restore(start + 2, start + 2)
}

const selected = computed(() => {
  const cells = lines.value[sel.line] ?? []
  return sel.start < sel.end ? cells.slice(sel.start, sel.end) : null
})

function toggle(format: MotdFormat) {
  if (showCodes.value) return insertCode(MOTD_FORMATS.find((f) => f.format === format)!.code)
  const on = !isOn(format)
  restyle((s) => ({ ...s, [format]: on }))
}
function isOn(format: MotdFormat) {
  if (showCodes.value) return false
  const cells = selected.value
  return cells ? cells.every((c) => c.style[format]) : typingStyle(sel.line, sel.start)[format]
}

const colourOpen = ref(false)
function setColour(code: ColourCode | null) {
  colourOpen.value = false
  if (showCodes.value) return insertCode(code ?? 'r')
  restyle((s) => ({ ...s, colour: code }))
}
const currentColour = computed<ColourCode | null | undefined>(() => {
  if (showCodes.value) return undefined
  const cells = selected.value
  if (!cells) return typingStyle(sel.line, sel.start).colour
  const first = cells[0]!.style.colour
  return cells.every((c) => c.style.colour === first) ? first : undefined
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

    <div class="space-y-2">
      <div v-for="(label, i) in LINES" :key="i" class="motd-field">
        <template v-if="showCodes">
          <input
            :ref="setInput(i)"
            :value="raw[i]"
            :aria-label="label"
            :placeholder="i ? 'Second line (optional)' : 'First line'"
            class="motd-input motd-raw"
            spellcheck="false"
            autocomplete="off"
            :data-e2e="`motd-line-${i + 1}`"
            @input="onRawInput(i, $event)"
            @focus="track(i)"
            @select="track(i)"
            @keyup="track(i)"
            @click="track(i)"
          />
        </template>
        <template v-else>
          <div class="motd-mirror" aria-hidden="true">
            <span :style="{ transform: `translateX(-${scroll[i] ?? 0}px)` }">
              <span
                v-for="(run, k) in toRuns(lines[i] ?? [])"
                :key="k"
                :style="cellStyle(run.style)"
                :class="run.style.obfuscated && 'motd-obfuscated'"
                >{{ run.text }}</span
              >
            </span>
          </div>
          <input
            :ref="setInput(i)"
            :value="plain(i)"
            :aria-label="label"
            :placeholder="i ? 'Second line (optional)' : 'First line'"
            class="motd-input motd-rich"
            spellcheck="false"
            autocomplete="off"
            :data-e2e="`motd-line-${i + 1}`"
            @input="onRichInput(i, $event)"
            @focus="track(i)"
            @select="track(i)"
            @keyup="track(i)"
            @click="track(i)"
            @scroll="track(i)"
          />
        </template>
      </div>
      <p v-if="lines.length > 2" class="text-sm text-muted">
        This MOTD has more than two lines; switch to <strong>Show codes</strong> to see them all.
      </p>
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
.motd-mirror > span {
  display: inline-block;
}
.motd-input {
  position: relative;
  display: block;
  border: 1px solid var(--ui-border-accented);
  background: #121212;
  outline: none;
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
.motd-field:has(.motd-rich) {
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
