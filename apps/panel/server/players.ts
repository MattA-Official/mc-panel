/** Pure helpers for the Players tab: parsing `list`, commands, and the JSON list files. */

export interface OnlinePlayers {
  count: number
  max: number
  names: string[]
}

export function parseList(reply: string): OnlinePlayers | null {
  const m = reply.match(/There are (\d+) of a max(?: of)? (\d+) players online:?\s*(.*)$/s)
  if (!m) return null
  const names = m[3]!
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
  return { count: Number(m[1]), max: Number(m[2]), names }
}

export type PlayerAction =
  'whitelist-add' | 'whitelist-remove' | 'op' | 'deop' | 'ban' | 'pardon' | 'kick'

/** The console command for an action. `name` must already be validated. */
export function commandFor(action: PlayerAction, name: string, reason?: string): string {
  const why = reason?.replace(/[\r\n]+/g, ' ').trim()
  switch (action) {
    case 'whitelist-add':
      return `whitelist add ${name}`
    case 'whitelist-remove':
      return `whitelist remove ${name}`
    case 'op':
      return `op ${name}`
    case 'deop':
      return `deop ${name}`
    case 'ban':
      return why ? `ban ${name} ${why}` : `ban ${name}`
    case 'pardon':
      return `pardon ${name}`
    case 'kick':
      return why ? `kick ${name} ${why}` : `kick ${name}`
  }
}

/** Replies Minecraft gives when a command did nothing or failed. */
const FAILURES = [
  /does not exist/i,
  /no player was found/i,
  /unknown or incomplete/i,
  /^nothing changed/i,
  /could not/i,
]
export const commandFailed = (reply: string) => FAILURES.some((r) => r.test(reply.trim()))

export type ListFile = 'whitelist.json' | 'ops.json' | 'banned-players.json'

export interface Entry {
  uuid: string
  name: string
  [key: string]: unknown
}

/** Minecraft's date format in banned-players.json. */
export function mcDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`
}

export function entryFor(
  file: ListFile,
  player: { uuid: string; name: string },
  opts: { reason?: string; now?: Date } = {},
): Entry {
  if (file === 'ops.json') return { ...player, level: 4, bypassesPlayerLimit: false }
  if (file === 'banned-players.json') {
    return {
      ...player,
      created: mcDate(opts.now ?? new Date()),
      source: 'Flytower',
      expires: 'forever',
      reason: opts.reason?.trim() || 'Banned by an operator.',
    }
  }
  return { ...player }
}

const same = (a: Entry, b: { uuid: string; name: string }) =>
  a.uuid === b.uuid || a.name.toLowerCase() === b.name.toLowerCase()

export function addEntry(list: Entry[], entry: Entry): Entry[] {
  return list.some((e) => same(e, entry)) ? list : [...list, entry]
}

export function removeEntry(list: Entry[], name: string): Entry[] {
  return list.filter((e) => e.name.toLowerCase() !== name.toLowerCase())
}

/** Which file an action edits while the server is stopped, and how. */
export const FILE_ACTIONS: Partial<Record<PlayerAction, { file: ListFile; add: boolean }>> = {
  'whitelist-add': { file: 'whitelist.json', add: true },
  'whitelist-remove': { file: 'whitelist.json', add: false },
  op: { file: 'ops.json', add: true },
  deop: { file: 'ops.json', add: false },
  ban: { file: 'banned-players.json', add: true },
  pardon: { file: 'banned-players.json', add: false },
}
