import type { ActionItem } from './server-actions'

/**
 * What the command palette (#107) offers besides the help pages: each server, with its
 * tabs and actions underneath ("Survival > Backups", "Survival > Restart"), then the
 * panel's pages. Server actions come from the same list as the right-click menus (#106).
 */

export interface PaletteLink {
  label: string
  icon?: string
  to?: string
  description?: string
  disabled?: boolean
  onSelect?: () => void
  children?: PaletteLink[]
}

/** Opening a server from the menu is the server itself; these would only repeat it. */

const SKIP = new Set(['Open console', 'Open in new tab'])

/** A server's palette entries, from its action groups. */
export function serverLinks(
  server: { name: string; displayName: string },
  actions: ActionItem[][],
): PaletteLink {
  const children: PaletteLink[] = []
  const flat = actions.flat()
  for (const item of flat.filter((i) => i.children)) {
    for (const tab of item.children!) children.push(toLink(tab))
  }
  for (const item of flat) {
    if (item.children || item.type || !item.label || SKIP.has(item.label)) continue
    children.push(toLink(item))
  }
  return {
    label: server.displayName,
    icon: 'i-lucide-server',
    to: `/servers/${server.name}`,
    description: server.displayName === server.name ? undefined : server.name,
    children,
  }
}

function toLink(item: ActionItem): PaletteLink {
  return {
    label: item.label!,
    icon: item.icon,
    to: item.to,
    description: item.description,
    disabled: item.disabled,
    onSelect: item.onSelect ? () => item.onSelect!() : undefined,
  }
}

/**
 * Servers in palette order: the one you're on, then the ones you opened lately, then the
 * rest as listed.
 */
export function orderServers<T extends { name: string }>(
  servers: T[],
  current: string | null,
  recent: string[],
): T[] {
  const rank = (s: T) => {
    if (s.name === current) return -1
    const i = recent.indexOf(s.name)
    return i < 0 ? recent.length : i
  }
  return servers
    .map((s, i) => ({ s, i, r: rank(s) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.s)
}

/** Remembers a server as just opened: newest first, five at most. */
export function rememberServer(recent: string[], name: string): string[] {
  return [name, ...recent.filter((n) => n !== name)].slice(0, 5)
}

export interface PaletteGroup {
  id: string
  label: string
  items: (PaletteLink & { prefix?: string; suffix?: string })[]
}

/**
 * The palette's groups for servers: the servers themselves, then each one's tabs and
 * actions labelled with its name ("Survival › Backups"), so typing "survival back" finds
 * them. Before anything is typed, only the server you're on shows its tabs and actions.
 * Several words put the tabs and actions first.
 */
export function serverGroups(
  servers: { server: { name: string; displayName: string }; link: PaletteLink }[],
  current: string | null,
  query: string,
): PaletteGroup[] {
  const typing = query.trim() !== ''
  const serversGroup: PaletteGroup = {
    id: 'servers',
    label: 'Servers',
    items: servers.map(({ link }) => ({
      ...link,
      children: undefined,
      suffix: link.description,
      description: undefined,
    })),
  }
  const groups: PaletteGroup[] = []
  for (const { server, link } of servers) {
    if (!typing && server.name !== current) continue
    groups.push({
      id: `server-${server.name}`,
      label: server.displayName,
      items: (link.children ?? []).map((c) => ({
        ...c,
        label: `${server.displayName} › ${c.label}`,
        suffix: c.description,
        description: undefined,
      })),
    })
  }
  // "survival files" means the tab, not the server, so the servers come after; one word
  // ("surv") is most likely the server itself.
  return /\s/.test(query.trim()) ? [...groups, serversGroup] : [serversGroup, ...groups]
}
