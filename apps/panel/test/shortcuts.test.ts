import { expect, test } from 'bun:test'
import {
  JUMPS,
  SHEET,
  jumpKbds,
  jumpTarget,
  neighbourServer,
  stepRow,
} from '../app/utils/shortcuts'
import { SHORTCUTS_KEY, RIGHT_CLICK_KEY, switchEnabled } from '../app/utils/action-menus'
import { serverGroups } from '../app/utils/palette'

const jump = (key: string) => JUMPS.find((j) => j.key === key)!

test('every jump is G then one letter, with no repeats', () => {
  const keys = JUMPS.map((j) => j.key)
  expect(new Set(keys).size).toBe(keys.length)
  for (const j of JUMPS) {
    expect(j.key).toMatch(/^g-[a-z]$/)
    expect(j.kbds).toEqual(['G', j.key.at(-1)!.toUpperCase()])
  }
})

test('page jumps work anywhere; tab jumps only on a server', () => {
  expect(jumpTarget(jump('g-s'), null)).toBe('/')
  expect(jumpTarget(jump('g-a'), 'survival')).toBe('/activity')
  expect(jumpTarget(jump('g-y'), null)).toBe('/system')
  expect(jumpTarget(jump('g-f'), null)).toBeNull()
  expect(jumpTarget(jump('g-c'), 'survival')).toBe('/servers/survival')
  expect(jumpTarget(jump('g-p'), 'survival')).toBe('/servers/survival/players')
  expect(jumpTarget(jump('g-b'), 'survival')).toBe('/servers/survival/world#backups')
  expect(jumpTarget(jump('g-n'), 'survival')).toBe('/servers/survival/content')
  expect(jumpTarget(jump('g-t'), 'survival')).toBe('/servers/survival/settings')
  expect(jumpTarget(jump('g-m'), 'survival')).toBe('/servers/survival/settings/yaml')
})

test('[ and ] keep the tab and wrap round', () => {
  const names = ['a', 'b', 'c']
  expect(neighbourServer(names, 'a', '/servers/a/files', 1)).toBe('/servers/b/files')
  expect(neighbourServer(names, 'a', '/servers/a', -1)).toBe('/servers/c')
  expect(neighbourServer(names, 'c', '/servers/c/settings/yaml', 1)).toBe(
    '/servers/a/settings/yaml',
  )
  expect(neighbourServer(['a'], 'a', '/servers/a', 1)).toBeNull()
  expect(neighbourServer(names, 'zzz', '/servers/zzz', 1)).toBeNull()
})

test('J and K move within the list', () => {
  expect(stepRow(0, -1, 1)).toBe(-1)
  expect(stepRow(3, -1, 1)).toBe(0)
  expect(stepRow(3, -1, -1)).toBe(2)
  expect(stepRow(3, 0, 1)).toBe(1)
  expect(stepRow(3, 2, 1)).toBe(2)
  expect(stepRow(3, 0, -1)).toBe(0)
})

test('the sheet lists every jump once', () => {
  const listed = SHEET.flatMap((g) => g.items).flatMap((i) => i.kbds.map((k) => k.join(' ')))
  for (const j of JUMPS) expect(listed.filter((k) => k === j.kbds.join(' '))).toHaveLength(1)
  expect(listed).toContain('?')
  expect(listed).toContain('L')
})

test('each switch is on unless switched off, and only its own', () => {
  const off = (key: string) => ({ getItem: (k: string) => (k === key ? 'off' : null) })
  expect(switchEnabled(null, SHORTCUTS_KEY)).toBe(true)
  expect(switchEnabled(off(SHORTCUTS_KEY), SHORTCUTS_KEY)).toBe(false)
  expect(switchEnabled(off(RIGHT_CLICK_KEY), SHORTCUTS_KEY)).toBe(true)
  expect(
    switchEnabled(
      {
        getItem: () => {
          throw new Error('denied')
        },
      },
      SHORTCUTS_KEY,
    ),
  ).toBe(true)
})

test('palette hints show only on the server you are on', () => {
  expect(jumpKbds('Backups')).toEqual(['G', 'B'])
  expect(jumpKbds('Servers')).toBeUndefined()
  const entry = (name: string) => ({
    server: { name, displayName: name },
    link: { label: name, to: `/servers/${name}`, children: [{ label: 'Files' }] },
  })
  const groups = serverGroups([entry('a'), entry('b')], 'a', 'files x')
  const files = (id: string) => groups.find((g) => g.id === id)!.items[0]!
  expect(files('server-a').kbds).toEqual(['G', 'F'])
  expect(files('server-b').kbds).toBeUndefined()
})
