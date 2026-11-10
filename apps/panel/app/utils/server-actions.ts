import type { Permission } from '../../shared/permissions'

/**
 * The actions for one server, as menu groups. The ⋯ button on a server card and its
 * right-click menu both come from here, so they can't drift apart (#106). The command
 * palette (#107) will use the same list.
 */

/** The shape Nuxt UI's dropdown and context menus take. */
export interface ActionItem {
  label?: string
  icon?: string
  description?: string
  color?: 'error'
  disabled?: boolean
  type?: 'label' | 'separator'
  to?: string
  target?: string
  children?: ActionItem[]
  onSelect?: (e?: Event) => void
  [key: string]: unknown
}

/** Where each part of a server page lives. Kept in step with the tabs (#177). */
export const serverRoutes = (name: string) => {
  const base = `/servers/${name}`
  return {
    console: base,
    logs: `${base}?logs=`,
    players: `${base}/players`,
    backups: `${base}/world`,
    backupNow: `${base}/world?backup=now`,
    content: `${base}/content`,
    world: `${base}/world`,
    files: `${base}/files`,
    settings: `${base}/settings`,
    yaml: `${base}/settings/yaml`,
    clone: `${base}/settings/maintenance?clone=1`,
    delete: `${base}/settings/maintenance?delete=1`,
  }
}

export interface ServerActionContext {
  server: { name: string; displayName: string }
  /** Whether it's running or starting, so Restart and Stop make sense. */
  running: boolean
  /** Content updates waiting, from the update badge (#59). */
  updates: number
  /** Whether the system helper is up. Power actions need it. */
  agentOk: boolean
  can: (permission: Permission, server?: string) => boolean
  /** The page's own origin, for copying a link to the server. */
  origin: string
  go: (to: string) => void
  openInNewTab: (to: string) => void
  copy: (text: string, what: string) => void
  /** Copies the address players connect with. */
  copyAddress: () => void
  power: (action: 'start' | 'restart' | 'stop') => void
}

export function serverActions(ctx: ServerActionContext): ActionItem[][] {
  const { server, can } = ctx
  const name = server.name
  const r = serverRoutes(name)
  const groups: ActionItem[][] = []

  groups.push([
    { label: 'Open console', icon: 'i-lucide-terminal', onSelect: () => ctx.go(r.console) },
    {
      label: 'Open in new tab',
      icon: 'i-lucide-external-link',
      onSelect: () => ctx.openInNewTab(r.console),
    },
    {
      label: 'Copy link',
      icon: 'i-lucide-link',
      onSelect: () => ctx.copy(`${ctx.origin}${r.console}`, 'Link'),
    },
  ])

  if (can('server.power', name)) {
    const helperDown = ctx.agentOk
      ? {}
      : { disabled: true, description: "The system helper isn't running" }
    groups.push(
      ctx.running
        ? [
            {
              label: 'Restart',
              icon: 'i-lucide-rotate-cw',
              ...helperDown,
              onSelect: () => ctx.power('restart'),
            },
            {
              label: 'Stop',
              icon: 'i-lucide-square',
              ...helperDown,
              onSelect: () => ctx.power('stop'),
            },
          ]
        : [
            {
              label: 'Start',
              icon: 'i-lucide-play',
              ...helperDown,
              onSelect: () => ctx.power('start'),
            },
          ],
    )
  }

  const quick: ActionItem[] = [
    { label: 'Copy address', icon: 'i-lucide-copy', onSelect: () => ctx.copyAddress() },
  ]
  if (can('backups.create', name)) {
    quick.push({
      label: 'Back up now',
      icon: 'i-lucide-archive',
      onSelect: () => ctx.go(r.backupNow),
    })
  }
  if (ctx.updates > 0) {
    quick.push({
      label: 'Review updates',
      icon: 'i-lucide-arrow-up-circle',
      description: `${ctx.updates} update${ctx.updates === 1 ? '' : 's'} available`,
      onSelect: () => ctx.go(r.content),
    })
  }
  groups.push(quick)

  const goTo: ActionItem[] = [
    ...(can('console.read', name)
      ? [{ label: 'Logs', icon: 'i-lucide-scroll-text', onSelect: () => ctx.go(r.logs) }]
      : []),
    { label: 'Players', icon: 'i-lucide-users', onSelect: () => ctx.go(r.players) },
    { label: 'Backups', icon: 'i-lucide-archive', onSelect: () => ctx.go(r.backups) },
    { label: 'Content', icon: 'i-lucide-package', onSelect: () => ctx.go(r.content) },
    { label: 'World', icon: 'i-lucide-globe', onSelect: () => ctx.go(r.world) },
    ...(can('files.read', name)
      ? [{ label: 'Files', icon: 'i-lucide-folder-open', onSelect: () => ctx.go(r.files) }]
      : []),
    { label: 'Settings', icon: 'i-lucide-sliders-horizontal', onSelect: () => ctx.go(r.settings) },
  ]
  groups.push([{ label: 'Go to', icon: 'i-lucide-corner-down-right', children: goTo }])

  // Nothing destructive runs from here: both open the page's own confirm.
  const manage: ActionItem[] = []
  if (can('servers.create')) {
    manage.push({ label: 'Clone…', icon: 'i-lucide-copy-plus', onSelect: () => ctx.go(r.clone) })
  }
  if (can('server.delete', name)) {
    manage.push({
      label: 'Delete…',
      icon: 'i-lucide-trash-2',
      color: 'error',
      onSelect: () => ctx.go(r.delete),
    })
  }
  if (manage.length) groups.push(manage)

  return groups
}

/** Where to read about an installed mod, plugin or datapack, if it has a page. */
export function contentPage(item: { source: string; slug: string }): string | null {
  if (item.source === 'modrinth') return `https://modrinth.com/project/${item.slug}`
  if (item.source === 'vanillatweaks') return 'https://vanillatweaks.net/picker/datapacks/'
  return null
}

export interface ContentActionContext {
  item: { title: string; source: string; slug: string; versionNumber: string; asked: boolean }
  /** The version an update would bring, if there is one. */
  updateTo: string | null
  update: () => void
  remove: () => void
  copy: (text: string, what: string) => void
  openInNewTab: (url: string) => void
}

/** Actions for one installed item on Content, for its ⋯ button and right-click menu. */
export function contentActions(ctx: ContentActionContext): ActionItem[][] {
  const { item } = ctx
  const page = contentPage(item)
  const groups: ActionItem[][] = []
  if (ctx.updateTo) {
    groups.push([
      {
        label: `Update to ${ctx.updateTo}`,
        icon: 'i-lucide-arrow-up',
        onSelect: () => ctx.update(),
      },
    ])
  }
  groups.push([
    ...(page
      ? [
          {
            label: 'Open project page',
            icon: 'i-lucide-external-link',
            onSelect: () => ctx.openInNewTab(page),
          },
        ]
      : []),
    {
      label: 'Copy version',
      icon: 'i-lucide-copy',
      onSelect: () => ctx.copy(item.versionNumber, 'Version'),
    },
  ])
  // Items pulled in by another one go when it does, so they can't be removed alone.
  if (item.asked) {
    groups.push([
      {
        label: 'Remove…',
        icon: 'i-lucide-trash-2',
        color: 'error',
        onSelect: () => ctx.remove(),
      },
    ])
  }
  return groups
}

export type PlayerList = 'online' | 'whitelist' | 'ops' | 'banned'
export type PlayerAction = 'op' | 'deop' | 'kick' | 'whitelist-remove' | 'pardon'

export interface PlayerActionContext {
  player: { name: string; uuid: string }
  /** Which list the row is in: who's online, or an entry in a list. */
  list: PlayerList
  isOp: boolean
  /** Whether the person may manage players; without it only the copy items show. */
  canManage: boolean
  act: (action: PlayerAction) => void
  /** Fills the ban form with this player, so a reason can be added before banning. */
  startBan: () => void
  copy: (text: string, what: string) => void
}

/** Actions for a player row on Players, for its ⋯ button and right-click menu. */
export function playerActions(ctx: PlayerActionContext): ActionItem[][] {
  const { player, canManage } = ctx
  const groups: ActionItem[][] = []
  if (canManage) {
    const manage: ActionItem[] = []
    if (ctx.list === 'online') {
      manage.push(
        ctx.isOp
          ? {
              label: 'Remove operator',
              icon: 'i-lucide-shield-off',
              onSelect: () => ctx.act('deop'),
            }
          : { label: 'Make operator', icon: 'i-lucide-shield', onSelect: () => ctx.act('op') },
        { label: 'Kick', icon: 'i-lucide-log-out', onSelect: () => ctx.act('kick') },
        { label: 'Ban…', icon: 'i-lucide-ban', color: 'error', onSelect: () => ctx.startBan() },
      )
    } else if (ctx.list === 'whitelist') {
      manage.push({
        label: 'Remove from whitelist',
        icon: 'i-lucide-x',
        onSelect: () => ctx.act('whitelist-remove'),
      })
    } else if (ctx.list === 'ops') {
      manage.push({
        label: 'Remove operator',
        icon: 'i-lucide-shield-off',
        onSelect: () => ctx.act('deop'),
      })
    } else {
      manage.push({ label: 'Unban', icon: 'i-lucide-undo-2', onSelect: () => ctx.act('pardon') })
    }
    groups.push(manage)
  }
  groups.push([
    { label: 'Copy name', icon: 'i-lucide-copy', onSelect: () => ctx.copy(player.name, 'Name') },
    {
      label: 'Copy UUID',
      icon: 'i-lucide-fingerprint',
      onSelect: () => ctx.copy(player.uuid, 'UUID'),
    },
  ])
  return groups
}
