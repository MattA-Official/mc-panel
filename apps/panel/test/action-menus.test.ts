import { describe, expect, test } from 'bun:test'
import {
  isMenuKey,
  RIGHT_CLICK_KEY,
  switchEnabled,
  wantsBrowserMenu,
} from '../app/utils/action-menus'
import {
  contentActions,
  contentPage,
  playerActions,
  serverActions,
  type ActionItem,
  type PlayerActionContext,
  type ServerActionContext,
} from '../app/utils/server-actions'
import type { Permission } from '../shared/permissions'

/** Just enough of the DOM: an element that knows whether it's inside a field. */
function el(inField: boolean) {
  return { closest: (sel: string) => (inField && sel.includes('input') ? {} : null) }
}
const root = { contains: (n: unknown) => n === 'inside' } as unknown as Node
const noSelection = { isCollapsed: true, anchorNode: null, toString: () => '' }

describe('wantsBrowserMenu', () => {
  test('a plain right-click gets the Flytower menu', () => {
    expect(
      wantsBrowserMenu({ shiftKey: false, target: el(false) as never }, root, noSelection),
    ).toBe(false)
  })
  test('Shift always gets the browser menu', () => {
    expect(
      wantsBrowserMenu({ shiftKey: true, target: el(false) as never }, root, noSelection),
    ).toBe(true)
  })
  test('fields and editors get the browser menu', () => {
    expect(
      wantsBrowserMenu({ shiftKey: false, target: el(true) as never }, root, noSelection),
    ).toBe(true)
  })
  test('text selected inside the row gets the browser menu', () => {
    const sel = { isCollapsed: false, anchorNode: 'inside' as never, toString: () => 'Survival' }
    expect(wantsBrowserMenu({ shiftKey: false, target: el(false) as never }, root, sel)).toBe(true)
  })
  test('text selected elsewhere does not', () => {
    const sel = { isCollapsed: false, anchorNode: 'outside' as never, toString: () => 'Survival' }
    expect(wantsBrowserMenu({ shiftKey: false, target: el(false) as never }, root, sel)).toBe(false)
  })
})

test('isMenuKey', () => {
  expect(isMenuKey({ key: 'ContextMenu', shiftKey: false })).toBe(true)
  expect(isMenuKey({ key: 'F10', shiftKey: true })).toBe(true)
  expect(isMenuKey({ key: 'F10', shiftKey: false })).toBe(false)
  expect(isMenuKey({ key: 'k', shiftKey: false })).toBe(false)
})

test('switchEnabled is on unless switched off', () => {
  expect(switchEnabled(null, RIGHT_CLICK_KEY)).toBe(true)
  expect(switchEnabled({ getItem: () => null }, RIGHT_CLICK_KEY)).toBe(true)
  expect(
    switchEnabled({ getItem: (k) => (k === RIGHT_CLICK_KEY ? 'off' : null) }, RIGHT_CLICK_KEY),
  ).toBe(false)
  expect(
    switchEnabled(
      {
        getItem: () => {
          throw new Error('blocked')
        },
      },
      RIGHT_CLICK_KEY,
    ),
  ).toBe(true)
})

describe('serverActions', () => {
  const calls: string[] = []
  function ctx(over: Partial<ServerActionContext> = {}): ServerActionContext {
    return {
      server: { name: 'survival', displayName: 'Survival' },
      running: false,
      updates: 0,
      agentOk: true,
      can: () => true,
      origin: 'https://panel.example',
      go: (to) => calls.push(`go ${to}`),
      openInNewTab: (to) => calls.push(`tab ${to}`),
      copy: (text) => calls.push(`copy ${text}`),
      copyAddress: () => calls.push('address'),
      power: (a) => calls.push(`power ${a}`),
      ...over,
    }
  }
  const labels = (groups: ActionItem[][]) => groups.flat().map((i) => i.label)
  const find = (groups: ActionItem[][], label: string) =>
    groups.flat().find((i) => i.label === label)

  test('a stopped server offers Start; a running one Restart and Stop', () => {
    expect(labels(serverActions(ctx()))).toContain('Start')
    expect(labels(serverActions(ctx()))).not.toContain('Stop')
    const running = labels(serverActions(ctx({ running: true })))
    expect(running).toContain('Restart')
    expect(running).toContain('Stop')
    expect(running).not.toContain('Start')
  })

  test('power is disabled with a reason while the helper is down', () => {
    const start = find(serverActions(ctx({ agentOk: false })), 'Start')!
    expect(start.disabled).toBe(true)
    expect(start.description).toContain('system helper')
  })

  test('Review updates only appears when there are some', () => {
    expect(labels(serverActions(ctx()))).not.toContain('Review updates')
    const item = find(serverActions(ctx({ updates: 2 })), 'Review updates')!
    expect(item.description).toBe('2 updates available')
    calls.length = 0
    item.onSelect!()
    expect(calls).toEqual(['go /servers/survival/content'])
  })

  test('items follow permissions', () => {
    const viewer = labels(
      serverActions(ctx({ can: (p: Permission) => p === 'server.view' || p === 'console.read' })),
    )
    for (const hidden of ['Start', 'Back up now', 'Clone…', 'Delete…']) {
      expect(viewer).not.toContain(hidden)
    }
    expect(viewer).toContain('Copy address')
    const goTo = find(serverActions(ctx({ can: () => false })), 'Go to')!
    expect(goTo.children!.map((i) => i.label)).not.toContain('Files')
    expect(goTo.children!.map((i) => i.label)).not.toContain('Logs')
  })

  test('destructive items open the page that confirms them', () => {
    const groups = serverActions(ctx())
    calls.length = 0
    find(groups, 'Delete…')!.onSelect!()
    find(groups, 'Clone…')!.onSelect!()
    find(groups, 'Back up now')!.onSelect!()
    expect(calls).toEqual([
      'go /servers/survival/settings?delete=1#maintenance',
      'go /servers/survival/settings?clone=1#maintenance',
      'go /servers/survival/world?backup=now#backups',
    ])
    expect(find(groups, 'Delete…')!.color).toBe('error')
  })

  test('Copy link copies the console URL', () => {
    calls.length = 0
    find(serverActions(ctx()), 'Copy link')!.onSelect!()
    expect(calls).toEqual(['copy https://panel.example/servers/survival'])
  })
})

describe('contentActions', () => {
  const item = {
    title: 'Lithium',
    source: 'modrinth',
    slug: 'lithium',
    versionNumber: '0.15.0',
    asked: true,
  }
  const noop = () => {}
  const base = { update: noop, remove: noop, copy: noop, openInNewTab: noop }
  const labels = (g: ActionItem[][]) => g.flat().map((i) => i.label)

  test('offers an update only when there is one', () => {
    expect(labels(contentActions({ ...base, item, updateTo: null }))).not.toContain(
      'Update to 0.16.0',
    )
    expect(labels(contentActions({ ...base, item, updateTo: '0.16.0' }))[0]).toBe(
      'Update to 0.16.0',
    )
  })
  test('links to the project page where there is one', () => {
    expect(contentPage(item)).toBe('https://modrinth.com/project/lithium')
    expect(contentPage({ source: 'url', slug: '' })).toBeNull()
    expect(
      labels(contentActions({ ...base, item: { ...item, source: 'url' }, updateTo: null })),
    ).not.toContain('Open project page')
  })
  test('items another needs cannot be removed on their own', () => {
    expect(labels(contentActions({ ...base, item, updateTo: null }))).toContain('Remove…')
    expect(
      labels(contentActions({ ...base, item: { ...item, asked: false }, updateTo: null })),
    ).not.toContain('Remove…')
  })
})

describe('playerActions', () => {
  const calls: string[] = []
  const ctx = (over: Partial<PlayerActionContext> = {}): PlayerActionContext => ({
    player: { name: 'Steve', uuid: 'uuid-1' },
    list: 'online',
    isOp: false,
    canManage: true,
    act: (a) => calls.push(a),
    startBan: () => calls.push('ban'),
    copy: (text, what) => calls.push(`${what}:${text}`),
    ...over,
  })
  const labels = (g: ActionItem[][]) => g.flat().map((i) => i.label)

  test('online players can be opped, kicked or banned', () => {
    expect(labels(playerActions(ctx()))).toEqual([
      'Make operator',
      'Kick',
      'Ban…',
      'Copy name',
      'Copy UUID',
    ])
    expect(labels(playerActions(ctx({ isOp: true })))[0]).toBe('Remove operator')
  })
  test('list entries offer their one removal', () => {
    expect(labels(playerActions(ctx({ list: 'whitelist' })))[0]).toBe('Remove from whitelist')
    expect(labels(playerActions(ctx({ list: 'ops' })))[0]).toBe('Remove operator')
    expect(labels(playerActions(ctx({ list: 'banned' })))[0]).toBe('Unban')
  })
  test('without permission only the copy items show', () => {
    expect(labels(playerActions(ctx({ canManage: false })))).toEqual(['Copy name', 'Copy UUID'])
  })
  test('items call through with the right action', () => {
    calls.length = 0
    const g = playerActions(ctx({ list: 'banned' })).flat()
    for (const i of g) i.onSelect!()
    expect(calls).toEqual(['pardon', 'Name:Steve', 'UUID:uuid-1'])
  })
})
