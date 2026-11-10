/**
 * Mod and plugin commands, from the server's `help`. RCON has no tab-complete, but `help`
 * lists every command the console can run, so mods' commands show up by name with their
 * usage even though their argument trees don't.
 */
import type { CommandNode } from '../../shared/commands'

export interface HelpEntry {
  name: string
  usage: string
}

/** Paper's `help` is paged: `Help: Index (1/12)`. */
export function helpPages(reply: string): number {
  const m = /Help: Index \((\d+)\/(\d+)\)/.exec(reply)
  return m ? Number(m[2]) : 1
}

/**
 * Reads `help`. Vanilla and Fabric send one usage per command, which RCON joins with no
 * line breaks (`/advancement (grant|revoke)/attribute <target> …`), so it's split before
 * each `/name`. Paper lists `/name: description` lines under topic headings instead.
 */
export function parseHelp(reply: string): HelpEntry[] {
  const out = new Map<string, HelpEntry>()
  const paper = /^\/[^\s:]+: /m.test(reply) || /Help: Index/.test(reply)
  if (paper) {
    for (const line of reply.split('\n')) {
      const m = /^\/([^\s:]+): ?(.*)$/.exec(line.trim())
      if (m) out.set(m[1]!.toLowerCase(), { name: m[1]!.toLowerCase(), usage: m[2]!.trim() })
    }
    return [...out.values()]
  }
  for (const part of reply.split(/\n|\/(?=[a-z0-9_.:-]+(?:[ /\n]|$))/i)) {
    const m = /^\/?([a-z0-9_.:-]+)(?: (.*))?$/i.exec(part.trim())
    if (m) out.set(m[1]!.toLowerCase(), { name: m[1]!.toLowerCase(), usage: m[2]?.trim() ?? '' })
  }
  return [...out.values()]
}

/**
 * Adds the commands vanilla doesn't know to its tree: mods' and plugins' commands, with
 * their usage. With no vanilla tree, every command from `help` is added this way.
 */
export function mergeHelp(root: CommandNode | null, entries: HelpEntry[]): CommandNode {
  const merged: CommandNode = { ...root, literals: { ...root?.literals } }
  for (const { name, usage } of entries) {
    if (merged.literals![name]) continue
    merged.literals![name] = { run: true, usage }
  }
  return merged
}
