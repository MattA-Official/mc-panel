import type { ContentNavigationItem } from '@nuxt/content'
import { groupBySection, pageRoute, type DocsPage } from '@flytower/docs-layer/routes'

/**
 * The help pages grouped into their sections (from each page's `section` and `order`), for
 * the Help page's sidebar and search. Loaded once, the first time something asks.
 */
export function useDocsNavigation() {
  const nav = useState<ContentNavigationItem[] | null>('docs-navigation', () => null)
  const base = useAppConfig().docs?.base ?? '/help'
  if (!nav.value) {
    void queryCollectionNavigation('docs', ['section', 'order']).then((tree) => {
      const flat = tree.flatMap((item) => item.children ?? [item]) as (ContentNavigationItem &
        DocsPage)[]
      nav.value = groupBySection(flat).map((section) => ({
        title: section.title,
        path: pageRoute(section.pages[0]!.path, base),
        children: section.pages.map((p) => ({
          ...p,
          path: pageRoute(p.path, base),
          exact: true,
        })),
      }))
    })
  }
  return computed(() => nav.value ?? [])
}
