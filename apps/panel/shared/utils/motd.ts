/**
 * Minecraft's message of the day: `§` formatting codes, read and written the way the game
 * does, and laid out the way the multiplayer list shows it. The settings editor, the public
 * status page and Discord embeds all read MOTDs through here.
 */

export type ColourCode =
  '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'a' | 'b' | 'c' | 'd' | 'e' | 'f'

export interface MotdColour {
  code: ColourCode
  /** The game's own name, as in `/tellraw`. */
  id: string
  /** For people: "Dark aqua". */
  label: string
  hex: string
}

/** The 16 colours vanilla reads from `server.properties`. */
export const MOTD_COLOURS: readonly MotdColour[] = [
  { code: '0', id: 'black', label: 'Black', hex: '#000000' },
  { code: '1', id: 'dark_blue', label: 'Dark blue', hex: '#0000AA' },
  { code: '2', id: 'dark_green', label: 'Dark green', hex: '#00AA00' },
  { code: '3', id: 'dark_aqua', label: 'Dark aqua', hex: '#00AAAA' },
  { code: '4', id: 'dark_red', label: 'Dark red', hex: '#AA0000' },
  { code: '5', id: 'dark_purple', label: 'Dark purple', hex: '#AA00AA' },
  { code: '6', id: 'gold', label: 'Gold', hex: '#FFAA00' },
  { code: '7', id: 'gray', label: 'Grey', hex: '#AAAAAA' },
  { code: '8', id: 'dark_gray', label: 'Dark grey', hex: '#555555' },
  { code: '9', id: 'blue', label: 'Blue', hex: '#5555FF' },
  { code: 'a', id: 'green', label: 'Green', hex: '#55FF55' },
  { code: 'b', id: 'aqua', label: 'Aqua', hex: '#55FFFF' },
  { code: 'c', id: 'red', label: 'Red', hex: '#FF5555' },
  { code: 'd', id: 'light_purple', label: 'Light purple', hex: '#FF55FF' },
  { code: 'e', id: 'yellow', label: 'Yellow', hex: '#FFFF55' },
  { code: 'f', id: 'white', label: 'White', hex: '#FFFFFF' },
]

const COLOUR_BY_CODE = new Map(MOTD_COLOURS.map((c) => [c.code, c]))

export const colourHex = (code: ColourCode) => COLOUR_BY_CODE.get(code)!.hex

/** The multiplayer list draws an MOTD with no colour of its own in this grey. */
export const MOTD_DEFAULT_HEX = '#808080'

export type MotdFormat = 'bold' | 'italic' | 'underlined' | 'strikethrough' | 'obfuscated'

/** Formatting codes, in the order they're written. */
export const MOTD_FORMATS: readonly { format: MotdFormat; code: string; label: string }[] = [
  { format: 'obfuscated', code: 'k', label: 'Obfuscated' },
  { format: 'bold', code: 'l', label: 'Bold' },
  { format: 'strikethrough', code: 'm', label: 'Strikethrough' },
  { format: 'underlined', code: 'n', label: 'Underline' },
  { format: 'italic', code: 'o', label: 'Italic' },
]

const FORMAT_BY_CODE = new Map(MOTD_FORMATS.map((f) => [f.code, f.format]))

export interface MotdStyle {
  colour: ColourCode | null
  bold: boolean
  italic: boolean
  underlined: boolean
  strikethrough: boolean
  obfuscated: boolean
}

export const PLAIN: Readonly<MotdStyle> = Object.freeze({
  colour: null,
  bold: false,
  italic: false,
  underlined: false,
  strikethrough: false,
  obfuscated: false,
})

export interface MotdRun {
  text: string
  style: MotdStyle
}

export type MotdLine = MotdRun[]

export const sameStyle = (a: MotdStyle, b: MotdStyle) =>
  a.colour === b.colour &&
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.underlined === b.underlined &&
  a.strikethrough === b.strikethrough &&
  a.obfuscated === b.obfuscated

/**
 * Reads `§` text into lines of styled runs, as the game does: codes are case-insensitive, a
 * colour clears bold and the rest, `§r` clears everything, an unknown code or a `§` at the
 * very end is dropped, and styles carry on over a line break.
 */
export function parseMotd(text: string): MotdLine[] {
  const lines: MotdLine[] = [[]]
  let style: MotdStyle = { ...PLAIN }
  let buffer = ''
  const flush = () => {
    if (!buffer) return
    const line = lines.at(-1)!
    const last = line.at(-1)
    if (last && sameStyle(last.style, style)) last.text += buffer
    else line.push({ text: buffer, style: { ...style } })
    buffer = ''
  }
  const chars = [...text.replace(/\r\n?/g, '\n')]
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!
    if (c === '\n') {
      flush()
      lines.push([])
      continue
    }
    if (c !== '§') {
      buffer += c
      continue
    }
    const code = chars[++i]?.toLowerCase()
    if (code === undefined) break
    flush()
    if (code === 'r') style = { ...PLAIN }
    else if (COLOUR_BY_CODE.has(code as ColourCode)) {
      style = { ...PLAIN, colour: code as ColourCode }
    } else {
      const format = FORMAT_BY_CODE.get(code)
      if (format) style = { ...style, [format]: true }
    }
  }
  flush()
  return lines
}

/** The text of an MOTD with every code taken out. */
export const motdPlainText = (text: string) =>
  parseMotd(text)
    .map((l) => l.map((r) => r.text).join(''))
    .join('\n')

/**
 * Writes lines back as `§` text with as few codes as it can, carrying the style over line
 * breaks as the game does. Empty lines at the end are left off.
 */
export function serialiseMotd(lines: MotdLine[]): string {
  const kept = [...lines]
  while (kept.length > 1 && !kept.at(-1)!.some((r) => r.text)) kept.pop()
  let state: MotdStyle = { ...PLAIN }
  return kept
    .map((line) =>
      line
        .filter((r) => r.text)
        .map((run) => {
          const codes = codesBetween(state, run.style)
          state = run.style
          return codes + run.text.replaceAll('§', '')
        })
        .join(''),
    )
    .join('\n')
}

function codesBetween(from: MotdStyle, to: MotdStyle): string {
  if (sameStyle(from, to)) return ''
  const loses = MOTD_FORMATS.some((f) => from[f.format] && !to[f.format])
  let codes = ''
  let base: MotdStyle = from
  if (loses || from.colour !== to.colour) {
    // Turning a format off, or changing colour, both start again from plain.
    codes = to.colour ? `§${to.colour}` : '§r'
    base = { ...PLAIN, colour: to.colour }
  }
  for (const f of MOTD_FORMATS) if (to[f.format] && !base[f.format]) codes += `§${f.code}`
  return codes
}

// Layout ------------------------------------------------------------------------------------

/** How wide a line of the multiplayer list can be, in the game's pixels, before it wraps. */
export const MOTD_LINE_WIDTH = 271
/** The list shows this many lines; anything after is cut off. */
export const MOTD_VISIBLE_LINES = 2

// The default font's advance (glyph plus one pixel of spacing) for ASCII that isn't six.
const ADVANCE: Record<string, number> = {
  '!': 2,
  "'": 2,
  ',': 2,
  '.': 2,
  ':': 2,
  ';': 2,
  i: 2,
  '|': 2,
  '`': 3,
  l: 3,
  ' ': 4,
  ' ': 4,
  I: 4,
  '[': 4,
  ']': 4,
  t: 4,
  '"': 5,
  '(': 5,
  ')': 5,
  '*': 5,
  '<': 5,
  '>': 5,
  f: 5,
  k: 5,
  '{': 5,
  '}': 5,
  '@': 7,
  '~': 7,
}

/** A character's width in the game's pixels; bold adds one. */
export const glyphAdvance = (c: string, bold = false) => (ADVANCE[c] ?? 6) + (bold ? 1 : 0)

export const runWidth = (run: MotdRun) =>
  [...run.text].reduce((w, c) => w + glyphAdvance(c, run.style.bold), 0)

export const lineWidth = (line: MotdLine) => line.reduce((w, r) => w + runWidth(r), 0)

export interface MotdLayout {
  /** What the list shows: at most two lines, each already wrapped. */
  visible: MotdLine[]
  /** Text the list wraps onto a third line or later, so never shows. */
  hidden: string
  /** Each written line's width in the game's pixels. */
  widths: number[]
  /** Written lines the list wraps because they're too wide (0 is the first). */
  wrapped: number[]
}

/**
 * Lays an MOTD out as the multiplayer list does: each line wraps at the last space that
 * fits (or mid-word if none does), and only the first two lines are shown.
 */
export function layoutMotd(text: string, width = MOTD_LINE_WIDTH): MotdLayout {
  const written = parseMotd(text)
  const all: MotdLine[] = []
  const wrapped: number[] = []
  written.forEach((line, i) => {
    const pieces = wrapLine(line, width)
    if (pieces.length > 1) wrapped.push(i)
    all.push(...pieces)
  })
  return {
    visible: all.slice(0, MOTD_VISIBLE_LINES),
    hidden: all
      .slice(MOTD_VISIBLE_LINES)
      .map((l) => l.map((r) => r.text).join(''))
      .join(' ')
      .trim(),
    widths: written.map(lineWidth),
    wrapped,
  }
}

function wrapLine(line: MotdLine, width: number): MotdLine[] {
  const cells = line.flatMap((r) => [...r.text].map((ch) => ({ ch, style: r.style })))
  const out: MotdLine[] = []
  let start = 0
  while (true) {
    let w = 0
    let lastSpace = -1
    let end = cells.length
    for (let i = start; i < cells.length; i++) {
      const cell = cells[i]!
      const advance = glyphAdvance(cell.ch, cell.style.bold)
      if (w + advance > width && i > start) {
        end = i
        break
      }
      if (cell.ch === ' ') lastSpace = i
      w += advance
    }
    if (end === cells.length) {
      out.push(toRuns(cells.slice(start)))
      return out
    }
    if (lastSpace > start) {
      out.push(toRuns(cells.slice(start, lastSpace)))
      start = lastSpace + 1
    } else {
      out.push(toRuns(cells.slice(start, end)))
      start = end
    }
  }
}

function toRuns(cells: { ch: string; style: MotdStyle }[]): MotdLine {
  const runs: MotdLine = []
  for (const { ch, style } of cells) {
    const last = runs.at(-1)
    if (last && sameStyle(last.style, style)) last.text += ch
    else runs.push({ text: ch, style })
  }
  return runs
}

/** Random characters of the same width, as the game draws obfuscated text. */
export function obfuscate(text: string, random: () => number = Math.random): string {
  return [...text]
    .map((c) => {
      if (c === ' ') return c
      const same = OBFUSCATE_POOL.get(glyphAdvance(c))
      return same ? same[Math.floor(random() * same.length)]! : c
    })
    .join('')
}

const OBFUSCATE_POOL = new Map<number, string[]>()
for (let code = 0x21; code < 0x7f; code++) {
  const c = String.fromCharCode(code)
  const w = glyphAdvance(c)
  OBFUSCATE_POOL.set(w, [...(OBFUSCATE_POOL.get(w) ?? []), c])
}
