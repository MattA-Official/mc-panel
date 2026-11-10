import { helpFor, pageRoute, parseHelpTarget, type HelpTarget } from '@flytower/docs-layer/routes'

/**
 * The help panel: which docs page it shows and whether it's open. The page header's Help
 * button opens the page that explains the current route; "Learn more" links open a page and
 * heading of their own.
 */
export function useHelp() {
  const open = useState('help-open', () => false)
  const target = useState<HelpTarget | null>('help-target', () => null)
  const base = useAppConfig().docs?.base ?? '/help'
  const route = useRoute()

  /** Opens `page#heading` (e.g. "backups#off-site-copies") in the help panel. */
  function show(to: string) {
    target.value = parseHelpTarget(to, base)
    open.value = true
  }

  /** Opens the help for the page you're on, or the docs overview if nothing covers it. */
  async function showForRoute() {
    const pages = await queryCollection('docs').select('path', 'panelRoute').all()
    target.value = helpFor(pages, route.path) ?? parseHelpTarget('readme', base)
    open.value = true
  }

  /** The full-page route for what the panel shows. */
  const fullPage = computed(() =>
    target.value
      ? `${pageRoute(target.value.path, base)}${target.value.hash ? `#${target.value.hash}` : ''}`
      : base,
  )

  return { open, target, base, show, showForRoute, fullPage }
}
