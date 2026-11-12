import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { docAnchor } from '../anchors'
import {
  parseLabels,
  SCREENSHOT_NAME,
  screenshotFiles,
  screenshotsInMarkdown,
  type ScreenshotData,
} from '../screens'

const root = resolve(import.meta.dir, '../../..')
const docsDir = join(root, 'docs')
const screensDir = join(docsDir, 'screens')

describe('screenshot blocks', () => {
  test('parseLabels splits on commas and spaces', () => {
    expect(parseLabels('a.b, c.d  e.f')).toEqual(['a.b', 'c.d', 'e.f'])
    expect(parseLabels(undefined)).toEqual([])
  })

  test('screenshotsInMarkdown reads each block', () => {
    const md = [
      'Text :ui{anchor="x"}',
      '::screenshot{name="backups" anchor="world.backups" labels="backups.back-up-now, backups.keep"}',
      'Caption.',
      '::',
      '::screenshot{name="phone-one" anchor="servers.new" device="phone"}',
      '::',
    ].join('\n')
    expect(screenshotsInMarkdown(md, 'x.md')).toEqual([
      {
        name: 'backups',
        anchor: 'world.backups',
        labels: ['backups.back-up-now', 'backups.keep'],
        device: 'desktop',
        file: 'x.md',
      },
      { name: 'phone-one', anchor: 'servers.new', labels: [], device: 'phone', file: 'x.md' },
    ])
  })

  test('names are safe file names', () => {
    expect(SCREENSHOT_NAME.test('new-server')).toBe(true)
    for (const bad of ['', 'New', '../x', 'a b', 'a--b', '-a']) {
      expect(SCREENSHOT_NAME.test(bad)).toBe(false)
    }
    expect(screenshotFiles('people')).toEqual({
      light: 'people-light.webp',
      dark: 'people-dark.webp',
      data: 'people.json',
    })
  })
})

describe('the docs and docs/screens agree', () => {
  const specs = readdirSync(docsDir)
    .filter((f) => f.endsWith('.md'))
    .flatMap((f) => screenshotsInMarkdown(readFileSync(join(docsDir, f), 'utf8'), f))

  test('every screenshot has a good name, real anchors, and is used once', () => {
    const problems: string[] = []
    const seen = new Set<string>()
    for (const s of specs) {
      if (!SCREENSHOT_NAME.test(s.name)) problems.push(`${s.file}: bad name "${s.name}"`)
      if (seen.has(s.name)) problems.push(`${s.file}: "${s.name}" used twice`)
      seen.add(s.name)
      for (const id of [s.anchor, ...s.labels]) {
        if (!docAnchor(id)) problems.push(`${s.file}: ${s.name}: no anchor "${id}"`)
      }
    }
    expect(problems).toEqual([])
  })

  // Run `bun run docs:screens <name>` after adding or changing a ::screenshot block.
  test('every screenshot has been taken, with the labels the docs ask for', () => {
    const problems: string[] = []
    for (const s of specs) {
      const files = screenshotFiles(s.name)
      for (const file of [files.light, files.dark, files.data]) {
        if (!existsSync(join(screensDir, file))) problems.push(`${s.name}: no docs/screens/${file}`)
      }
      if (!existsSync(join(screensDir, files.data))) continue
      const data = JSON.parse(readFileSync(join(screensDir, files.data), 'utf8')) as ScreenshotData
      const taken = data.labels.map((l) => l.anchor)
      if (taken.join() !== s.labels.join()) {
        problems.push(`${s.name}: taken with [${taken}], the docs ask for [${s.labels}]`)
      }
      if (data.device !== s.device) problems.push(`${s.name}: taken as ${data.device}`)
    }
    expect(problems).toEqual([])
  })

  test('docs/screens holds nothing the docs no longer use', () => {
    const used = new Set(specs.flatMap((s) => Object.values(screenshotFiles(s.name))))
    const stale = existsSync(screensDir)
      ? readdirSync(screensDir).filter((f) => !used.has(f) && f !== 'README.md')
      : []
    expect(stale).toEqual([])
  })
})
