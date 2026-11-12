import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { isPermission } from '../../../apps/panel/shared/permissions'
import {
  anchorRoute,
  anchorSelector,
  actionsInMarkdown,
  anchorsInMarkdown,
  canDo,
  docAnchor,
  docAnchors,
  needsServer,
} from '../anchors'
import { routeScore } from '../routes'

const root = resolve(import.meta.dir, '../../..')
const docsDir = join(root, 'docs')
const appDir = join(root, 'apps/panel/app')
const pagesDir = join(appDir, 'pages')

describe('anchor helpers', () => {
  test('actionsInMarkdown finds only the chips that ask Help to press them', () => {
    const md = [
      ':ui{anchor="backups.back-up-now" do} and :ui[Restart it]{anchor="server.restart" do}.',
      ':ui{anchor="schedules.add-task"}, :ui{anchor="access.invite" done="x"}.',
    ].join('\n')
    expect(actionsInMarkdown(md)).toEqual(['backups.back-up-now', 'server.restart'])
  })

  test('canDo only allows listed safe actions', () => {
    expect(canDo('backups.back-up-now')).toBe(true)
    expect(canDo('access.invite')).toBe(false)
    expect(canDo('nope')).toBe(false)
  })

  test('anchorRoute fills in the server and keeps the section', () => {
    const anchor = docAnchor('backups.back-up-now')!
    expect(needsServer(anchor)).toBe(true)
    expect(anchorRoute(anchor, 'survival')).toBe('/servers/survival/world#backups')
    expect(anchorRoute(anchor, 'a b')).toBe('/servers/a%20b/world#backups')
    expect(() => anchorRoute(anchor)).toThrow()
    const people = docAnchor('access.invite')!
    expect(needsServer(people)).toBe(false)
    expect(anchorRoute(people)).toBe('/access')
  })

  test('docAnchor only knows listed anchors', () => {
    expect(docAnchor('nope')).toBeNull()
    expect(docAnchor('toString')).toBeNull()
  })

  test('anchorSelector quotes the id', () => {
    expect(anchorSelector('backups.back-up-now')).toBe('[data-doc="backups.back-up-now"]')
    expect(anchorSelector('a"b')).toBe('[data-doc="a\\"b"]')
  })

  test('anchorsInMarkdown finds inline and block components', () => {
    const md = [
      'Press :ui{anchor="schedules.add-task"} then :ui{anchor="schedules.run-now" .x}.',
      '::screenshot{anchor="world.backups"}',
      'Not this: {anchor="x"} or `:ui` alone.',
    ].join('\n')
    expect(anchorsInMarkdown(md)).toEqual([
      'schedules.add-task',
      'schedules.run-now',
      'world.backups',
    ])
  })
})

/** Panel page routes, as patterns: pages/servers/[name]/world/index.vue → /servers/:name/world. */
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

/** Every anchor id the panel marks: `data-doc="…"` on an element, `doc: '…'` on a section. */
function panelAnchors(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const file of new Bun.Glob('**/*.vue').scanSync(appDir)) {
    const source = readFileSync(join(appDir, file), 'utf8')
    // A bound `:data-doc="…"` is an expression, not an id.
    for (const m of source.matchAll(/(?<![:\w-])data-doc="([^"]+)"|\bdoc: '([^']+)'/g)) {
      const id = (m[1] ?? m[2])!
      found.set(id, [...(found.get(id) ?? []), file])
    }
  }
  return found
}

describe('docs, anchors and the panel agree', () => {
  const marked = panelAnchors()

  test('every anchor the docs name is listed', () => {
    const problems: string[] = []
    for (const file of readdirSync(docsDir).filter((f) => f.endsWith('.md'))) {
      for (const id of anchorsInMarkdown(readFileSync(join(docsDir, file), 'utf8'))) {
        if (!docAnchor(id)) problems.push(`${file}: no anchor "${id}" in anchors.ts`)
      }
    }
    expect(problems).toEqual([])
  })

  test('docs only ask Help to press controls on the safe list', () => {
    const problems: string[] = []
    for (const file of readdirSync(docsDir).filter((f) => f.endsWith('.md'))) {
      for (const id of actionsInMarkdown(readFileSync(join(docsDir, file), 'utf8'))) {
        if (!canDo(id)) problems.push(`${file}: "${id}" isn't a safe action (action: true)`)
      }
    }
    expect(problems).toEqual([])
  })

  test('every listed anchor is marked in the panel, and nothing else is', () => {
    const listed = Object.keys(docAnchors)
    expect(listed.filter((id) => !marked.has(id))).toEqual([])
    expect([...marked.keys()].filter((id) => !docAnchor(id))).toEqual([])
  })

  test('every anchor is on a real panel page, with a real permission', () => {
    const routes = panelPages()
    const problems: string[] = []
    for (const [id, anchor] of Object.entries(docAnchors)) {
      const path = anchor.route.split('#')[0]!
      if (!routes.some((r) => routeScore(path, r.replace(/\*\*$/, 'x')) !== null)) {
        problems.push(`${id}: no panel page matches ${path}`)
      }
      if ('need' in anchor && !isPermission(anchor.need)) {
        problems.push(`${id}: no permission "${anchor.need}"`)
      }
    }
    expect(problems).toEqual([])
  })
})
