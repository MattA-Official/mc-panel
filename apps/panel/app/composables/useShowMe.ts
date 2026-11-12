import {
  anchorRoute,
  canDo,
  docAnchor,
  needsServer,
  type DocAnchor,
} from '@flytower/docs-layer/anchors'
import type { HelpTarget } from '@flytower/docs-layer/routes'
import type { Server } from './useServers'

/** What the spotlight is lighting up. */
export interface Spotlight {
  id: string
  label: string
  /** The permission it needs, for a clearer message when it isn't there. */
  need?: string
  /** When it only shows some of the time, from the anchor list. */
  shownWhen?: string
  server?: string
  /** The page it's on: leaving it ends the spotlight. */
  path: string
  /** Bumped on every Show me, so pressing it twice looks again. */
  seq: number
  /** Press the control once it's found ("Do it"): only for anchors marked `action`. */
  press?: boolean
}

/**
 * Help's "Show me" (#270): goes to the page with the control a docs page names, opens its
 * section, and lights the control up (DocSpotlight draws it). Pages on one server use the
 * server you're on; from anywhere else, the only server, or you pick one.
 */
export function useShowMe() {
  const spotlight = useState<Spotlight | null>('doc-spotlight', () => null)
  /** Where "Back to help" goes: the help panel's page, or the full-page help route. */
  const back = useState<{ panel: HelpTarget | null; route: string | null } | null>(
    'doc-spotlight-back',
    () => null,
  )
  /** A Show me waiting for you to choose a server, and the servers to choose from. */
  const picking = useState<{ id: string; press: boolean; servers: Server[] } | null>(
    'doc-pick',
    () => null,
  )
  const help = useHelp()
  const route = useRoute()
  // The router's own route: useRoute() in a layout lags behind until the new page has loaded.
  const now = useRouter().currentRoute
  const toast = useToast()

  /** The server whose page you're on, if any. */
  const currentServer = () =>
    route.path.startsWith('/servers/') && route.params.name ? String(route.params.name) : null

  /**
   * Show me, or with `press` ("Do it") also press the control, so its own confirm, passkey
   * check and permissions take over. Only anchors on the safe list can be pressed.
   */
  async function show(id: string, press = false) {
    const anchor = docAnchor(id)
    if (!anchor) return
    press = press && canDo(id)
    back.value = {
      panel: help.open.value ? help.target.value : null,
      route: route.path.startsWith(help.base) ? route.fullPath : null,
    }
    if (!needsServer(anchor)) return go(id, anchor, undefined, press)
    const here = currentServer()
    if (here) return go(id, anchor, here, press)
    let servers: Server[] = []
    try {
      servers = await $fetch<Server[]>('/api/servers')
    } catch {
      // Treated like having none: the message below says what to do.
    }
    if (servers.length === 1) return go(id, anchor, servers[0]!.name, press)
    if (!servers.length) {
      toast.add({
        title: `${anchor.label} is on a server's page`,
        description: 'Create a server first, then try again.',
        icon: 'i-lucide-server',
        color: 'neutral',
      })
      return
    }
    picking.value = { id, press, servers }
  }

  /** Carries on with a Show me once you've chosen its server. */
  function pick(server: string) {
    const waiting = picking.value
    picking.value = null
    const anchor = waiting && docAnchor(waiting.id)
    if (anchor) void go(waiting.id, anchor, server, waiting.press)
  }

  async function go(id: string, anchor: DocAnchor, server?: string, press = false) {
    help.open.value = false
    const to = anchorRoute(anchor, server)
    const [path = '', hash = ''] = to.split('#')
    if (now.value.path !== path || now.value.hash !== (hash ? `#${hash}` : '')) {
      await navigateTo(to)
    }
    // Open its World or Settings section, even when the address already pointed there.
    if (hash) {
      await nextTick()
      window.dispatchEvent(new CustomEvent('docs:reveal', { detail: hash }))
    }
    spotlight.value = {
      id,
      label: anchor.label,
      need: anchor.need,
      shownWhen: anchor.shownWhen,
      server,
      path: now.value.path,
      seq: (spotlight.value?.seq ?? 0) + 1,
      press,
    }
  }

  /** Ends the spotlight and goes back to the help page it came from. */
  async function backToHelp() {
    const to = back.value
    spotlight.value = null
    back.value = null
    if (to?.route) return navigateTo(to.route)
    if (to?.panel) {
      help.target.value = to.panel
      help.open.value = true
    }
  }

  return { spotlight, back, picking, show, pick, backToHelp }
}
