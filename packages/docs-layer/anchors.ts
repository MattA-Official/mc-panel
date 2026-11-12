/**
 * Named places in the panel that the docs can point at (#270).
 *
 * A control the docs talk about carries `data-doc="<id>"` in the panel, and its id is listed
 * here once. The docs then name it with `:ui{anchor="<id>"}`: the website shows a chip that
 * looks like the control, and the panel's Help shows the same chip as a button that goes to
 * the control and lights it up ("Show me").
 *
 * Pure TypeScript with no Nuxt imports, so `bun test` can check that the docs, this list and
 * the panel agree.
 */

export type DocAnchorKind = 'button' | 'field' | 'section' | 'card'

export interface DocAnchor {
  /** What the control is called in the panel, word for word, e.g. "Back up now". */
  label: string
  /**
   * The panel page that shows it. `:name` is filled with a server; `#<id>` opens a World or
   * Settings section.
   */
  route: string
  kind: DocAnchorKind
  /** The control's icon, so the chip looks like it. */
  icon?: string
  /**
   * The permission needed to see or use it, for a clearer message when it isn't there.
   * A name from the panel's permissions list, e.g. "backups.create".
   */
  need?: string
}

export const docAnchors = {
  // Your first server
  'servers.new': {
    label: 'New server',
    route: '/',
    kind: 'button',
    icon: 'i-lucide-plus',
    need: 'servers.create',
  },
  'new-server.name': {
    label: 'Name',
    route: '/servers/new',
    kind: 'field',
    need: 'servers.create',
  },
  'new-server.loader': {
    label: 'Loader',
    route: '/servers/new',
    kind: 'field',
    need: 'servers.create',
  },
  'new-server.memory': {
    label: 'Memory',
    route: '/servers/new',
    kind: 'field',
    need: 'servers.create',
  },
  'new-server.port': {
    label: 'Port',
    route: '/servers/new',
    kind: 'field',
    need: 'servers.create',
  },
  'new-server.create': {
    label: 'Create server',
    route: '/servers/new',
    kind: 'button',
    need: 'servers.create',
  },

  // Backups
  'world.backups': {
    label: 'Backups',
    route: '/servers/:name/world#backups',
    kind: 'section',
    icon: 'i-lucide-archive',
  },
  'backups.back-up-now': {
    label: 'Back up now',
    route: '/servers/:name/world#backups',
    kind: 'button',
    icon: 'i-lucide-archive',
    need: 'backups.create',
  },
  'backups.schedule': {
    label: 'Schedule',
    route: '/servers/:name/world#backups',
    kind: 'card',
    icon: 'i-lucide-calendar-clock',
    need: 'backups.schedule',
  },
  'backups.keep': {
    label: 'Keep',
    route: '/servers/:name/world#backups',
    kind: 'field',
    need: 'backups.schedule',
  },

  // Scheduled tasks
  'settings.schedules': {
    label: 'Schedules',
    route: '/servers/:name/settings#schedules',
    kind: 'section',
    icon: 'i-lucide-calendar-clock',
  },
  'schedules.add-task': {
    label: 'Add task',
    route: '/servers/:name/settings#schedules',
    kind: 'button',
    icon: 'i-lucide-plus',
    need: 'schedules.manage',
  },
  'schedules.run-now': {
    label: 'Run now',
    route: '/servers/:name/settings#schedules',
    kind: 'button',
    icon: 'i-lucide-play',
    need: 'schedules.manage',
  },

  // People and roles
  'access.invite': {
    label: 'Invite someone',
    route: '/access',
    kind: 'button',
    icon: 'i-lucide-user-plus',
    need: 'people.invite',
  },
  'access.new-role': {
    label: 'New role',
    route: '/access/roles',
    kind: 'button',
    icon: 'i-lucide-plus',
    need: 'roles.manage',
  },
} as const satisfies Record<string, DocAnchor>

export type DocAnchorId = keyof typeof docAnchors

/** The anchor with this id, or null if there's no such anchor. */
export function docAnchor(id: string): DocAnchor | null {
  return Object.hasOwn(docAnchors, id) ? docAnchors[id as DocAnchorId] : null
}

/** Whether the anchor's page belongs to one server, so Show me needs to know which. */
export function needsServer(anchor: DocAnchor): boolean {
  return anchor.route.split('#')[0]!.split('/').includes(':name')
}

/**
 * The route to open for an anchor: `:name` becomes the server (encoded), and the `#section`
 * stays so World and Settings open it.
 */
export function anchorRoute(anchor: DocAnchor, server?: string): string {
  return anchor.route.replace(/:name\b/g, () => {
    if (!server) throw new Error(`"${anchor.label}" is on a server's page; say which server`)
    return encodeURIComponent(server)
  })
}

/** The CSS selector for an anchor's element in the panel. */
export function anchorSelector(id: string): string {
  return `[data-doc="${id.replace(/["\\]/g, '\\$&')}"]`
}

/** Every anchor a docs page names, in `:ui{anchor="…"}` (and later blocks) order. */
export function anchorsInMarkdown(markdown: string): string[] {
  const found: string[] = []
  for (const [, attrs] of markdown.matchAll(/:{1,2}[a-z][\w-]*\{([^}]*)\}/g)) {
    for (const [, value] of attrs!.matchAll(/\banchor="([^"]*)"/g)) found.push(value!)
  }
  return found
}
