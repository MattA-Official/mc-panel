/**
 * Turns the game's own reports into the console's command catalogue. Running the vanilla
 * server jar with `--reports` writes `commands.json` (every command, as the game's command
 * tree) and `registries.json` (item, block, entity ids and the rest) for that exact version.
 * Only what completion needs is kept.
 */
import type { ArgNode, CommandNode } from '../../shared/commands'
import { shortId } from '../../shared/commands'

/** Bumped when the stored shape changes, so older files are made again. */
export const FORMAT = 1

/** What's kept for one Minecraft version. */
export interface VanillaCommands {
  format: typeof FORMAT
  minecraft: string
  root: CommandNode
  registries: Record<string, string[]>
}

/** A node as the game writes it. Both the older and the 26.x shapes are read. */
interface RawNode {
  type?: string
  children?: Record<string, RawNode>
  executable?: boolean
  redirect?: string[]
  /** Up to 1.21: the argument type and its settings. */
  parser?: string
  properties?: Record<string, unknown>
  /** 26.x: `{ type, ...settings }`. */
  argument?: { type?: string } & Record<string, unknown>
  custom_suggestion?: { type?: string; values?: unknown }
}

/** Registries always worth keeping, beyond those the tree names. */
const ALWAYS = ['item', 'block', 'entity_type', 'mob_effect', 'particle_type', 'sound_event']

function convert(raw: RawNode, registries: Set<string>, name?: string): CommandNode | ArgNode {
  const node: CommandNode = {}
  for (const [childName, child] of Object.entries(raw.children ?? {})) {
    if (child.type === 'argument') {
      ;(node.args ??= []).push(convert(child, registries, childName) as ArgNode)
    } else {
      ;(node.literals ??= {})[childName] = convert(child, registries)
    }
  }
  if (raw.executable) node.run = true
  if (Array.isArray(raw.redirect)) node.redirect = raw.redirect.map(String)
  // `execute … run` has nothing after it and doesn't run: it goes back to the start. The
  // game leaves the redirect out because the path to the root is empty.
  else if (!raw.children && !raw.executable && raw.type !== 'root') node.redirect = []
  if (raw.type !== 'argument') return node

  const settings = { ...(raw.properties ?? {}), ...(raw.argument ?? {}) }
  const fullType = String(raw.argument?.type ?? raw.parser ?? 'string')
  const arg: ArgNode = { name: name ?? 'value', type: fullType.split(':').pop()!, ...node }
  if (typeof settings.registry === 'string') {
    arg.registry = shortId(settings.registry)
    registries.add(arg.registry)
  }
  if (arg.type === 'entity') {
    // Older games: amount single|multiple and type players|entities.
    arg.players = settings.players_only === true || settings.type === 'players'
    arg.single = settings.single_result === true || settings.amount === 'single'
  }
  if (arg.type === 'string') {
    const kind = settings.type
    arg.string = kind === 'word' || kind === 'greedy' ? kind : 'phrase'
  }
  const suggestion = raw.custom_suggestion
  if (suggestion?.type) {
    const kind = shortId(suggestion.type)
    if (kind === 'literal' && Array.isArray(suggestion.values)) {
      arg.suggest = suggestion.values.map(String)
    } else if (kind !== 'ask_server') {
      arg.suggest = kind
    }
  }
  return arg
}

/**
 * Registry ids from `registries.json`. Mojang's report maps `minecraft:item` to
 * `{ entries: { "minecraft:stone": … } }`; a plain list of ids is read too.
 */
function registryIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => shortId(String(v)))
  const entries = (value as { entries?: Record<string, unknown> } | null)?.entries
  return entries ? Object.keys(entries).map(shortId) : []
}

/** Makes a version's catalogue from its `commands.json` and `registries.json`. */
export function parseReports(
  minecraft: string,
  commands: unknown,
  registriesReport: unknown,
): VanillaCommands {
  const raw = commands as RawNode
  if (!raw || typeof raw !== 'object' || !raw.children) {
    throw new Error('commands.json has no commands in it.')
  }
  const wanted = new Set(ALWAYS)
  const root = convert({ ...raw, type: 'root' }, wanted)
  const registries: Record<string, string[]> = {}
  const report = (registriesReport ?? {}) as Record<string, unknown>
  for (const [key, value] of Object.entries(report)) {
    const name = shortId(key)
    if (!wanted.has(name)) continue
    const ids = registryIds(value)
    if (ids.length > 0) registries[name] = ids.sort()
  }
  return { format: FORMAT, minecraft, root, registries }
}
