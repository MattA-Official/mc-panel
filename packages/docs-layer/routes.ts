/**
 * Pure helpers shared by the panel and the website: turning docs links into routes, choosing
 * the help page for a panel route, and grouping pages into sections. No Nuxt imports, so they
 * can be tested with bun test.
 */

/** A docs page as navigation or a query returns it, with the frontmatter we use. */
export interface DocsPage {
  path: string
  title?: string
  section?: string
  order?: number
  panelRoute?: string | string[]
}

/** Where a help link points: a docs page path and an optional heading id. */
export interface HelpTarget {
  path: string
  hash: string
}

/** The docs file name (without .md) that a page path ends in, e.g. "backups". */
export function docName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? ''
}

/** docs/README.md is the docs home page, so its path is the base itself. */
export function isIndex(path: string, base: string): boolean {
  return path === base || /\/readme$/i.test(path)
}

/** The route for a docs page path: README goes to the base. */
export function pageRoute(path: string, base: string): string {
  return isIndex(path, base) ? base : path
}

/** The collection path of the page that a docs route shows: the base shows README. */
export function routeToPage(route: string, base: string): string {
  const clean = route.replace(/\/$/, '') || '/'
  return clean === base ? `${base}/readme` : clean
}

/**
 * Docs link to each other as relative Markdown files (`install.md#options`), so they also work
 * on GitHub. Nuxt Content may leave the `.md` on or take it off; either way this returns the
 * route under `base`. Anything else (absolute, external, a bare anchor) is returned unchanged.
 */
export function docsHref(href: string, base: string): string {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) {
    return href
  }
  const match = href.match(/^(?:\.\/)?([\w-]+)(?:\.md)?(#[\w-]*)?$/)
  if (!match) return href
  const [, file = '', hash = ''] = match
  return `${/^readme$/i.test(file) ? base : `${base}/${file}`}${hash}`
}

/** Splits `backups#off-site-copies` (or `/help/backups#…`) into a page path and heading id. */
export function parseHelpTarget(target: string, base: string): HelpTarget {
  const [page = '', hash = ''] = target.split('#')
  const path = page.startsWith('/') ? page : `${base}/${page || 'readme'}`
  return { path: routeToPage(path, base), hash }
}

/**
 * How well a panel route pattern matches a path, or null if it doesn't. Patterns are paths
 * with `:param` segments and an optional trailing `/**` for "this and anything below". Exact
 * words count most, then parameters; `/**` adds nothing, so it only wins when nothing else fits.
 */
export function routeScore(pattern: string, path: string): number | null {
  const want = pattern.split('#')[0]!.split('/').filter(Boolean)
  const have = path.split(/[?#]/)[0]!.split('/').filter(Boolean)
  const rest = want.at(-1) === '**'
  if (rest) want.pop()
  if (rest ? have.length < want.length : have.length !== want.length) return null
  let score = 1
  for (const [i, part] of want.entries()) {
    if (part.startsWith(':')) score += 10
    else if (part === have[i]) score += 100
    else return null
  }
  return score
}

/** All the panel routes a page lists, as an array. */
export function panelRoutes(page: DocsPage): string[] {
  if (!page.panelRoute) return []
  return Array.isArray(page.panelRoute) ? page.panelRoute : [page.panelRoute]
}

/** The docs page (and heading) that best explains a panel route, or null if none does. */
export function helpFor(pages: DocsPage[], route: string): HelpTarget | null {
  let best: { score: number; target: HelpTarget } | null = null
  for (const page of pages) {
    for (const pattern of panelRoutes(page)) {
      const score = routeScore(pattern, route)
      if (score === null || (best && best.score >= score)) continue
      best = { score, target: { path: page.path, hash: pattern.split('#')[1] ?? '' } }
    }
  }
  return best?.target ?? null
}

/** A navigation section and its pages, in reading order. */
export interface DocsSection<T extends DocsPage> {
  title: string
  pages: T[]
}

/**
 * Groups pages by their `section` frontmatter. Pages are sorted by `order` (then title), and
 * sections follow their first page, so moving a section only means renumbering its pages.
 */
export function groupBySection<T extends DocsPage>(pages: T[]): DocsSection<T>[] {
  const sorted = [...pages].sort(
    (a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
      (a.title ?? '').localeCompare(b.title ?? ''),
  )
  const sections = new Map<string, T[]>()
  for (const page of sorted) {
    const title = page.section ?? 'More'
    sections.set(title, [...(sections.get(title) ?? []), page])
  }
  return [...sections].map(([title, list]) => ({ title, pages: list }))
}
