import { serverRoutes } from './server-actions'

/**
 * Flytower's keyboard shortcuts (#108), in one list. The handlers in `useShortcuts`, the
 * `?` sheet and the palette's hints all read from here, so they can't drift apart.
 * Kept free of Vue so it can be tested on its own.
 */

type ServerPart = keyof ReturnType<typeof serverRoutes>

export interface Jump {
  /** `defineShortcuts` key, e.g. `g-s`. */
  key: string
  /** How the sheet and hints show it. */
  kbds: string[]
  label: string
  /** A page anywhere in the panel, or a part of the server you're on. */
  to: string | { server: ServerPart }
}

export const JUMPS: Jump[] = [
  { key: 'g-s', kbds: ['G', 'S'], label: 'Servers', to: '/' },
  { key: 'g-a', kbds: ['G', 'A'], label: 'Activity', to: '/activity' },
  { key: 'g-y', kbds: ['G', 'Y'], label: 'System', to: '/system' },
  { key: 'g-c', kbds: ['G', 'C'], label: 'Console', to: { server: 'console' } },
  { key: 'g-l', kbds: ['G', 'L'], label: 'Logs', to: { server: 'logs' } },
  { key: 'g-p', kbds: ['G', 'P'], label: 'Players', to: { server: 'players' } },
  { key: 'g-b', kbds: ['G', 'B'], label: 'Backups', to: { server: 'backups' } },
  { key: 'g-n', kbds: ['G', 'N'], label: 'Content', to: { server: 'content' } },
  { key: 'g-w', kbds: ['G', 'W'], label: 'World', to: { server: 'world' } },
  { key: 'g-f', kbds: ['G', 'F'], label: 'Files', to: { server: 'files' } },
  { key: 'g-t', kbds: ['G', 'T'], label: 'Settings', to: { server: 'settings' } },
  { key: 'g-m', kbds: ['G', 'M'], label: 'YAML', to: { server: 'yaml' } },
]

/** Where a jump goes from here, or null when it needs a server and you aren't on one. */
export function jumpTarget(jump: Jump, server: string | null): string | null {
  if (typeof jump.to === 'string') return jump.to
  if (!server) return null
  return serverRoutes(server)[jump.to.server]
}

/** The shortcut for a server tab or action, by its label, for hints ("Backups  G B"). */
export function jumpKbds(label: string): string[] | undefined {
  return JUMPS.find((j) => typeof j.to !== 'string' && j.label === label)?.kbds
}

export interface SheetGroup {
  title: string
  items: { kbds: string[][]; label: string }[]
}

/** Everything the `?` sheet lists. Alternatives (J or ↓) are separate key lists. */
export const SHEET: SheetGroup[] = [
  {
    title: 'Anywhere',
    items: [
      { kbds: [['Ctrl', 'K']], label: 'Search servers, pages and actions' },
      { kbds: [['?']], label: 'Show these shortcuts' },
      { kbds: [['/']], label: "Focus the page's search or the console's command line" },
      { kbds: [['Ctrl', 'S']], label: 'Save Settings or a file; review YAML changes' },
      { kbds: [['Esc']], label: 'Close the open dialog, menu or editor' },
    ],
  },
  {
    title: 'Go to',
    items: JUMPS.filter((j) => typeof j.to === 'string').map((j) => ({
      kbds: [j.kbds],
      label: j.label,
    })),
  },
  {
    title: 'On a server',
    items: [
      ...JUMPS.filter((j) => typeof j.to !== 'string').map((j) => ({
        kbds: [j.kbds],
        label: j.label,
      })),
      { kbds: [['L']], label: 'Open the logs' },
      { kbds: [['['], [']']], label: 'Previous or next server, same tab' },
    ],
  },
  {
    title: 'Lists and cards',
    items: [
      { kbds: [['J'], ['K']], label: 'Next or previous row (arrow keys too)' },
      { kbds: [['Enter']], label: 'Open the row' },
      { kbds: [['.'], ['Shift', 'F10']], label: "Open the row's menu" },
      { kbds: [['Shift', 'Delete']], label: 'Delete, with its usual confirm' },
    ],
  },
]

/**
 * The same page on the previous or next server: `/servers/a/files` becomes
 * `/servers/b/files`. Wraps round at either end.
 */
export function neighbourServer(
  servers: string[],
  current: string,
  path: string,
  step: 1 | -1,
): string | null {
  const i = servers.indexOf(current)
  if (i < 0 || servers.length < 2) return null
  const next = servers[(i + step + servers.length) % servers.length]!
  const prefix = `/servers/${current}`
  const rest = path.startsWith(prefix) ? path.slice(prefix.length) : ''
  return `/servers/${next}${rest}`
}

/** The row to move to: J/↓ forwards, K/↑ back, staying within the list. */
export function stepRow(count: number, index: number, step: 1 | -1): number {
  if (count === 0) return -1
  if (index < 0) return step === 1 ? 0 : count - 1
  return Math.min(count - 1, Math.max(0, index + step))
}

/** Rows that keyboard movement goes through. ActionTarget marks them. */
export const ROW_SELECTOR = '[data-action-row]'

/** Where `/` goes: the page's own search box first, then the console's command line. */
export const FOCUS_SELECTOR = '[data-shortcut-search], input[aria-label="Command"]'
