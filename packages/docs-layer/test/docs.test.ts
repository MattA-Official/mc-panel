import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import {
  docsHref,
  groupBySection,
  helpFor,
  parseHelpTarget,
  routeScore,
  routeToPage,
  type DocsPage,
} from '../routes'

const root = resolve(import.meta.dir, '../../..')
const docsDir = join(root, 'docs')
const pagesDir = join(root, 'apps/panel/app/pages')
const appDir = join(root, 'apps/panel/app')

describe('docsHref', () => {
  test('turns Markdown file links into routes under the base', () => {
    expect(docsHref('install.md#options', '/help')).toBe('/help/install#options')
    expect(docsHref('install#options', '/docs')).toBe('/docs/install#options')
    expect(docsHref('./spec.md', '/help')).toBe('/help/spec')
    expect(docsHref('README.md', '/help')).toBe('/help')
  })
  test('leaves other links alone', () => {
    for (const href of ['https://modrinth.com', '#plans', '/servers/new', 'mailto:a@b.c', '']) {
      expect(docsHref(href, '/help')).toBe(href)
    }
  })
})

describe('routeScore and helpFor', () => {
  test('matches parameters and trailing wildcards', () => {
    expect(routeScore('/servers/:name/backups', '/servers/nnt/backups')).not.toBeNull()
    expect(routeScore('/servers/:name/backups', '/servers/nnt/world')).toBeNull()
    expect(routeScore('/servers/:name/**', '/servers/nnt/files')).not.toBeNull()
    expect(routeScore('/servers/:name/**', '/servers/nnt')).not.toBeNull()
    expect(routeScore('/', '/')).not.toBeNull()
    expect(routeScore('/', '/system')).toBeNull()
  })
  test('the most specific page wins, with its heading', () => {
    const pages: DocsPage[] = [
      { path: '/help/first-server', panelRoute: ['/servers/:name/**', '/servers/new'] },
      { path: '/help/backups', panelRoute: '/servers/:name/backups' },
      { path: '/help/backups', panelRoute: '/system/storage#off-site-copies' },
    ]
    expect(helpFor(pages, '/servers/nnt/backups')).toEqual({ path: '/help/backups', hash: '' })
    expect(helpFor(pages, '/servers/nnt/files')).toEqual({ path: '/help/first-server', hash: '' })
    expect(helpFor(pages, '/servers/new')).toEqual({ path: '/help/first-server', hash: '' })
    expect(helpFor(pages, '/system/storage')).toEqual({
      path: '/help/backups',
      hash: 'off-site-copies',
    })
    expect(helpFor(pages, '/activity')).toBeNull()
  })
  test('help targets and routes', () => {
    expect(parseHelpTarget('backups#off-site-copies', '/help')).toEqual({
      path: '/help/backups',
      hash: 'off-site-copies',
    })
    expect(parseHelpTarget('readme', '/help').path).toBe('/help/readme')
    expect(routeToPage('/help', '/help')).toBe('/help/readme')
    expect(routeToPage('/help/spec/', '/help')).toBe('/help/spec')
  })
})

test('groupBySection keeps reading order', () => {
  const groups = groupBySection([
    { path: '/b', title: 'B', section: 'Two', order: 10 },
    { path: '/a', title: 'A', section: 'One', order: 2 },
    { path: '/c', title: 'C', section: 'One', order: 1 },
  ])
  expect(groups.map((g) => g.title)).toEqual(['One', 'Two'])
  expect(groups[0]!.pages.map((p) => p.path)).toEqual(['/c', '/a'])
})

// The docs themselves: every link, help route and "Learn more" must land somewhere real, so a
// renamed heading or page fails here rather than in someone's panel.

/** Heading ids as Nuxt Content (github-slugger, then tidied) makes them. */
function headingIds(markdown: string): Set<string> {
  const ids = new Set<string>()
  const seen = new Map<string, number>()
  let fenced = false
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced
    const m = !fenced && line.match(/^#{1,6}\s+(.*)$/)
    if (!m) continue
    const text = m[1]!.replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    let slug = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
      .replace(/ /g, '-')
    const n = seen.get(slug) ?? 0
    seen.set(slug, n + 1)
    if (n) slug = `${slug}-${n}`
    ids.add(slug.replace(/-+/g, '-').replace(/^-|-$/g, '').replace(/^(\d)/, '_$1'))
  }
  return ids
}

const docs = new Map(
  readdirSync(docsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const source = readFileSync(join(docsDir, f), 'utf8')
      const front = source.match(/^---\n([\s\S]*?)\n---\n/)
      const meta = (front ? Bun.YAML.parse(front[1]!) : {}) as Record<string, unknown>
      return [
        f.replace(/\.md$/, '').toLowerCase(),
        { file: f, source, meta, ids: headingIds(source) },
      ]
    }),
)

/** Panel page routes, as patterns: pages/servers/[name]/backups.vue → /servers/:name/backups. */
function panelPages(dir = pagesDir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return panelPages(full)
    if (!entry.name.endsWith('.vue')) return []
    const route = `/${relative(pagesDir, full)}`
      .replace(/\.vue$/, '')
      .replace(/\/index$/, '')
      .replace(/\[\.\.\.\w+\]/g, '**')
      .replace(/\[(\w+)\]/g, ':$1')
    return [route || '/']
  })
}

function checkTarget(target: string, from: string): string | null {
  const [page = '', hash = ''] = target.split('#')
  const doc = docs.get(page.replace(/\.md$/, '').toLowerCase() || 'readme')
  if (!doc) return `${from}: no docs page "${page}"`
  if (hash && !doc.ids.has(hash)) return `${from}: ${doc.file} has no heading #${hash}`
  return null
}

describe('docs folder', () => {
  test('every page has a section and an order', () => {
    for (const { file, meta } of docs.values()) {
      expect(typeof meta.section, file).toBe('string')
      expect(typeof meta.order, file).toBe('number')
    }
  })

  test('links between pages point at real pages and headings', () => {
    const problems: string[] = []
    for (const { file, source } of docs.values()) {
      for (const [, href] of source.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^[a-z]+:/i.test(href!) || href!.startsWith('/')) continue
        if (href!.startsWith('#')) {
          if (!docs.get(file.replace(/\.md$/, '').toLowerCase())!.ids.has(href!.slice(1)))
            problems.push(`${file}: no heading ${href}`)
          continue
        }
        const problem = checkTarget(href!.replace(/^\.\//, ''), file)
        if (problem) problems.push(problem)
      }
    }
    expect(problems).toEqual([])
  })

  test('every panelRoute is a real panel page, and its heading exists', () => {
    const routes = panelPages()
    const problems: string[] = []
    for (const [name, { file, meta }] of docs) {
      const list = [meta.panelRoute ?? []].flat() as string[]
      for (const pattern of list) {
        const [path = '', hash] = pattern.split('#')
        if (!routes.some((r) => routeScore(path, r.replace(/\*\*$/, 'x')) !== null)) {
          problems.push(`${file}: no panel page matches ${path}`)
        }
        if (hash) {
          const problem = checkTarget(`${name}#${hash}`, file)
          if (problem) problems.push(problem)
        }
      }
    }
    expect(problems).toEqual([])
  })

  test('every "Learn more" link in the panel opens a real page and heading', () => {
    const glob = new Bun.Glob('**/*.vue')
    const problems: string[] = []
    let count = 0
    for (const file of glob.scanSync(appDir)) {
      const source = readFileSync(join(appDir, file), 'utf8')
      for (const [, target] of source.matchAll(/<HelpLink[^>]*\sto="([^"]+)"/g)) {
        count++
        const problem = checkTarget(target!, file)
        if (problem) problems.push(problem)
      }
    }
    expect(problems).toEqual([])
    expect(count).toBeGreaterThan(0)
  })
})
