/**
 * Console command completion. The panel turns the game's own command tree (from Mojang's
 * data generator) and the server's `help` into a catalogue; the console loads it once and
 * completes everything in the browser, so typing never waits on the network.
 */

/** One node of the command tree. */
export interface CommandNode {
  /** Fixed words that can come next, by name. */
  literals?: Record<string, CommandNode>
  /** Values that can come next, tried in order. */
  args?: ArgNode[]
  /** The command can end here. */
  run?: true
  /** Carries on from another node: its path from the root, where [] is the root itself. */
  redirect?: string[]
  /** For mod and plugin commands, which only come from `help`: their usage or description. */
  usage?: string
}

export interface ArgNode extends CommandNode {
  name: string
  /** The argument type without its namespace, like `entity`, `item_stack` or `integer`. */
  type: string
  /** For `resource`-style arguments: the registry, without `minecraft:`. */
  registry?: string
  /** Fixed suggestions, or a named set like `summonable_entities`. */
  suggest?: string[] | string
  /** Only players, for entity arguments. */
  players?: boolean
  /** One target only, for entity arguments. */
  single?: boolean
  /** How much of the line a string argument takes. */
  string?: 'word' | 'phrase' | 'greedy'
}

export interface Catalogue {
  root: CommandNode
  /** Registry ids, `minecraft:` left off, keyed by registry like `item` or `entity_type`. */
  registries: Record<string, string[]>
  /** Who's online now. */
  players: string[]
}

export interface Suggestion {
  /** What goes in the box. */
  text: string
  /** Shown beside it, like `<count>` or a mod command's usage. */
  detail?: string
}

export interface Completion {
  /** Where in the input the suggestions start: accepting one replaces everything from here. */
  from: number
  /** What's typed of the current word so far. */
  typed: string
  suggestions: Suggestion[]
  /** The shape of the command so far, like `give <targets> <item> [<count>]`. */
  hint: string | null
}

const MAX_SUGGESTIONS = 50

/** Arguments that take more than one word. */
const WORDS: Record<string, number> = {
  vec3: 3,
  block_pos: 3,
  vec2: 2,
  column_pos: 2,
  rotation: 2,
}

const COLOURS = [
  'black',
  'dark_blue',
  'dark_green',
  'dark_aqua',
  'dark_red',
  'dark_purple',
  'gold',
  'gray',
  'dark_gray',
  'blue',
  'green',
  'aqua',
  'red',
  'light_purple',
  'yellow',
  'white',
]

/** Arguments with a small fixed set of values. */
const FIXED: Record<string, string[]> = {
  bool: ['true', 'false'],
  gamemode: ['survival', 'creative', 'adventure', 'spectator'],
  dimension: ['overworld', 'the_nether', 'the_end'],
  color: [...COLOURS, 'reset'],
  team_color: [...COLOURS, 'reset'],
  entity_anchor: ['eyes', 'feet'],
  heightmap: ['world_surface', 'motion_blocking', 'motion_blocking_no_leaves', 'ocean_floor'],
  template_mirror: ['none', 'front_back', 'left_right'],
  template_rotation: ['none', 'clockwise_90', '180', 'counterclockwise_90'],
  operation: ['=', '+=', '-=', '*=', '/=', '%=', '<', '>', '><'],
  scoreboard_slot: ['list', 'sidebar', 'below_name'],
  swizzle: ['xyz', 'xy', 'xz', 'yz', 'x', 'y', 'z'],
  vec3: ['~ ~ ~'],
  block_pos: ['~ ~ ~'],
  vec2: ['~ ~'],
  column_pos: ['~ ~'],
  rotation: ['~ ~'],
}

/** Older games' argument types, and the registry each one draws from. */
const REGISTRY_OF: Record<string, string> = {
  item_stack: 'item',
  item_predicate: 'item',
  block_state: 'block',
  block_predicate: 'block',
  entity_summon: 'entity_type',
  mob_effect: 'mob_effect',
  item_enchantment: 'enchantment',
  particle: 'particle_type',
}

/** Named suggestion sets in the command tree, and the registry behind each. */
const SUGGEST_REGISTRY: Record<string, string> = {
  summonable_entities: 'entity_type',
  available_sounds: 'sound_event',
}

/** Splits off `minecraft:`, which the game lets you leave out. */
export function shortId(id: string): string {
  return id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id
}

/**
 * Where a word ends: the next space outside quotes and brackets, so selectors like
 * `@e[type=pig, limit=1]` and NBT like `{Count:1b, id:"x"}` count as one word.
 */
function wordEnd(input: string, pos: number): number {
  let depth = 0
  let quote: string | null = null
  let i = pos
  for (; i < input.length; i++) {
    const c = input[i]!
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '[' || c === '{' || c === '(') depth++
    else if (c === ']' || c === '}' || c === ')') depth = Math.max(0, depth - 1)
    else if (c === ' ' && depth === 0) break
  }
  return Math.min(i, input.length)
}

/** Where an argument of this type, starting at `pos`, ends. */
function argEnd(arg: ArgNode, input: string, pos: number): number {
  if (arg.type === 'message' || arg.string === 'greedy') return input.length
  if (arg.type === 'string' && arg.string === 'word') {
    const space = input.indexOf(' ', pos)
    return space < 0 ? input.length : space
  }
  let end = pos
  const words = WORDS[arg.type] ?? 1
  for (let w = 0; w < words; w++) {
    end = wordEnd(input, end)
    if (w < words - 1) {
      if (input[end] !== ' ') break
      end++
    }
  }
  return end
}

const COORD = /^[~^]?-?\d*\.?\d*$/

/**
 * Whether typed text could be this argument. Only numbers, booleans and coordinates are
 * checked; anything else is taken as given, as the server will check it anyway.
 */
function fits(arg: ArgNode, text: string): boolean {
  if (WORDS[arg.type]) return text.split(' ').every((w) => COORD.test(w))
  switch (arg.type) {
    case 'integer':
    case 'long':
      return /^-?\d+$/.test(text)
    case 'float':
    case 'double':
      return /^-?(\d+\.?\d*|\.\d+)$/.test(text)
    case 'bool':
      return text === 'true' || text === 'false'
    default:
      return text.length > 0
  }
}

function resolve(root: CommandNode, path: string[]): CommandNode | null {
  let node: CommandNode | undefined = root
  for (const name of path) {
    node = node.literals?.[name] ?? node.args?.find((a) => a.name === name)
    if (!node) return null
  }
  return node
}

/** A node, after following its redirect. */
function follow(root: CommandNode, node: CommandNode): CommandNode {
  for (let hops = 0; node.redirect && hops < 8; hops++) {
    const next = resolve(root, node.redirect)
    if (!next) break
    node = next
  }
  return node
}

const label = (name: string, arg: boolean) => (arg ? `<${name}>` : name)

/** What can come after a node, briefly: `<item> [<count>]` or `(add|remove)`. */
function shape(root: CommandNode, node: CommandNode, depth = 4): string {
  if (node.redirect) return node.redirect.length === 0 ? '<command>' : '…'
  const literals = Object.keys(node.literals ?? {})
  const args = node.args ?? []
  const kids = literals.length + args.length
  if (kids === 0 || depth === 0) return kids === 0 ? '' : '…'
  let s: string
  if (kids === 1) {
    const [name, child, isArg] = args[0]
      ? [args[0].name, args[0] as CommandNode, true]
      : [literals[0]!, node.literals![literals[0]!]!, false]
    const rest = shape(root, child, depth - 1)
    s = label(name, isArg) + (rest ? ` ${rest}` : '')
  } else {
    const names = [...literals, ...args.map((a) => label(a.name, true))]
    s = `(${names.slice(0, 5).join('|')}${names.length > 5 ? '|…' : ''})`
  }
  return node.run ? `[${s}]` : s
}

function selectors(arg: ArgNode): string[] {
  if (arg.type === 'entity') {
    const players = arg.players ? ['@p', '@r', '@s'] : ['@p', '@r', '@s', '@n']
    return arg.single ? players : [...players, '@a', ...(arg.players ? [] : ['@e'])]
  }
  if (arg.type === 'game_profile') return ['@p', '@r', '@s', '@a']
  if (arg.type === 'score_holder') return ['@p', '@r', '@s', '@a', '@e', '*']
  return []
}

/** Every value worth suggesting for an argument, before matching what's typed. */
export function valuesFor(arg: ArgNode, cat: Catalogue): string[] {
  if (Array.isArray(arg.suggest)) return arg.suggest
  if (typeof arg.suggest === 'string') {
    const registry = SUGGEST_REGISTRY[arg.suggest]
    const ids = registry ? (cat.registries[registry] ?? []) : []
    return arg.suggest === 'summonable_entities' ? ids.filter((id) => id !== 'player') : ids
  }
  if (arg.type === 'entity' || arg.type === 'game_profile' || arg.type === 'score_holder') {
    return [...cat.players, ...selectors(arg)]
  }
  if (FIXED[arg.type]) return FIXED[arg.type]!
  const registry = arg.registry ?? REGISTRY_OF[arg.type]
  return registry ? (cat.registries[registry] ?? []) : []
}

/**
 * Whether a value matches what's typed: at the start, or at the start of any part of it
 * (after `_`, `:`, `/` or `.`), the way the game matches. `minecraft:` may be typed or not.
 */
function matches(value: string, typed: string): 0 | 1 | 2 {
  if (typed === '') return 2
  const v = value.toLowerCase()
  const t = shortId(typed.toLowerCase())
  if (v.startsWith(t)) return 2
  for (let i = v.indexOf(t); i > 0; i = v.indexOf(t, i + 1)) {
    if ('_:/.'.includes(v[i - 1]!)) return 1
  }
  return 0
}

function suggest(
  root: CommandNode,
  node: CommandNode,
  input: string,
  pos: number,
  cat: Catalogue,
): { suggestions: Suggestion[]; typed: string; best: CommandNode | null } {
  const word = input.slice(pos, wordEnd(input, pos))
  const ranked: { s: Suggestion; rank: number; node: CommandNode }[] = []
  for (const [name, child] of Object.entries(node.literals ?? {})) {
    if (name.startsWith(word.toLowerCase())) {
      ranked.push({ s: { text: name, detail: child.usage }, rank: 3, node: child })
    }
  }
  let typed = word
  for (const arg of node.args ?? []) {
    const end = argEnd(arg, input, pos)
    if (end < input.length) continue
    const text = input.slice(pos)
    if (text.length > word.length) typed = text
    const seen = new Set(ranked.map((r) => r.s.text))
    for (const value of valuesFor(arg, cat)) {
      const rank = matches(value, text)
      if (rank && !seen.has(value)) {
        seen.add(value)
        ranked.push({ s: { text: value, detail: `<${arg.name}>` }, rank, node: arg })
      }
    }
  }
  ranked.sort((a, b) => b.rank - a.rank || (a.rank === 3 ? a.s.text.localeCompare(b.s.text) : 0))
  return {
    suggestions: ranked.slice(0, MAX_SUGGESTIONS).map((r) => r.s),
    typed,
    best: ranked[0]?.node ?? null,
  }
}

/**
 * What could come next, for an input with the caret at its end. Walks the tree word by word;
 * the last word, which has no space after it yet, is the one being completed.
 */
export function complete(input: string, cat: Catalogue): Completion {
  const root = cat.root
  let pos = input.startsWith('/') ? 1 : 0
  let node = root
  const path: string[] = []
  while (true) {
    node = follow(root, node)
    if (node.usage !== undefined && path.length > 0) {
      // A mod command: all we know is its usage.
      return {
        from: pos,
        typed: input.slice(pos),
        suggestions: [],
        hint: `${path[0]} ${node.usage}`,
      }
    }
    const end = wordEnd(input, pos)
    if (end >= input.length) {
      const { suggestions, typed, best } = suggest(root, node, input, pos, cat)
      const from = input.length - typed.length
      let hint: string | null = null
      if (path.length > 0) {
        const rest = shape(root, node)
        hint = [...path, rest].filter(Boolean).join(' ')
      } else if (best && suggestions.length > 0) {
        const head = suggestions[0]!.text
        hint = best.usage !== undefined ? `${head} ${best.usage}` : `${head} ${shape(root, best)}`
      }
      return { from, typed, suggestions, hint: hint?.trim() || null }
    }
    // A finished word: a fixed word first, then the first argument it fits.
    const word = input.slice(pos, end)
    const literal = node.literals?.[word.toLowerCase()]
    if (literal) {
      path.push(word.toLowerCase())
      node = literal
      pos = end + 1
      continue
    }
    // Brigadier takes whichever argument reads furthest, so coordinates still being typed
    // beat a one-word argument, and a message (the rest of the line) comes last.
    const tries = (node.args ?? []).map((arg) => {
      const at = argEnd(arg, input, pos)
      return { arg, end: at, text: input.slice(pos, at) }
    })
    const greedy = (a: ArgNode) => a.type === 'message' || a.string === 'greedy'
    const typing =
      tries.find((t) => t.end >= input.length && WORDS[t.arg.type] && fits(t.arg, t.text)) ??
      (tries.some((t) => t.end < input.length && !greedy(t.arg) && fits(t.arg, t.text))
        ? undefined
        : tries.find((t) => t.end >= input.length && greedy(t.arg)))
    if (typing) {
      // An argument of more than one word, still being typed.
      const { arg } = typing
      const typed = input.slice(pos)
      const suggestions = valuesFor(arg, cat)
        .filter((v) => matches(v, typed) === 2 && v !== typed)
        .slice(0, MAX_SUGGESTIONS)
        .map((text) => ({ text, detail: `<${arg.name}>` }))
      const rest = shape(root, arg)
      return {
        from: pos,
        typed,
        suggestions,
        hint: [...path, `<${arg.name}>`, rest].filter(Boolean).join(' '),
      }
    }
    // There's more after this word, so an argument that can be followed by more comes first.
    const more = (a: ArgNode) => Boolean(a.literals || a.args || a.redirect)
    const fitting = tries.filter((t) => t.end < input.length && fits(t.arg, t.text))
    const next = fitting.find((t) => more(t.arg)) ?? fitting[0] ?? null
    if (!next) {
      // Nothing in the tree fits: we don't know this command or its arguments.
      return { from: input.length, typed: '', suggestions: [], hint: null }
    }
    path.push(`<${next.arg.name}>`)
    node = next.arg
    pos = next.end + 1
  }
}

/** Joins a suggestion into the input. */
export function accept(input: string, c: Completion, s: Suggestion, space = true): string {
  return input.slice(0, c.from) + s.text + (space ? ' ' : '')
}

const JOINED = /: (?:System chat: )?([.*]?[A-Za-z0-9_]{1,16}) (joined|left) the game$/

/** Keeps the online list current from the console's own log lines. */
export function trackPlayers(players: string[], lines: string[]): string[] {
  let out = players
  for (const line of lines) {
    const m = JOINED.exec(line.trimEnd())
    if (!m) continue
    const name = m[1]!
    out = out.filter((p) => p !== name)
    if (m[2] === 'joined') out = [...out, name]
  }
  return out
}

/** Whether a log line says the server has finished starting. */
export const isReadyLine = (line: string) => /\]: Done \([\d.,]+m?s\)! For help, type/.test(line)
