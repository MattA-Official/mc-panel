import { describe, expect, test } from 'bun:test'
import { orderServers, rememberServer, serverGroups, serverLinks } from '../app/utils/palette'
import { serverActions } from '../app/utils/server-actions'

const servers = [
  { name: 'survival', displayName: 'Survival' },
  { name: 'creative', displayName: 'Creative' },
  { name: 'events', displayName: 'Events' },
]
const noop = () => {}
const linkFor = (s: (typeof servers)[number]) =>
  serverLinks(
    s,
    serverActions({
      server: s,
      running: true,
      updates: 0,
      agentOk: true,
      can: () => true,
      origin: '',
      go: noop,
      openInNewTab: noop,
      copy: noop,
      copyAddress: noop,
      power: noop,
    }),
  )

test('a server offers its tabs and actions, without repeating itself', () => {
  const labels = linkFor(servers[0]!).children!.map((c) => c.label)
  expect(labels).toContain('Backups')
  expect(labels).toContain('Restart')
  expect(labels).toContain('Back up now')
  expect(labels).not.toContain('Open console')
  expect(labels).not.toContain('Go to')
})

test('orderServers puts the current one first, then recent ones', () => {
  expect(orderServers(servers, 'events', ['creative']).map((s) => s.name)).toEqual([
    'events',
    'creative',
    'survival',
  ])
  expect(orderServers(servers, null, []).map((s) => s.name)).toEqual([
    'survival',
    'creative',
    'events',
  ])
})

test('rememberServer keeps five, newest first, without repeats', () => {
  expect(rememberServer(['a', 'b', 'c', 'd', 'e'], 'c')).toEqual(['c', 'a', 'b', 'd', 'e'])
  expect(rememberServer(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['f', 'a', 'b', 'c', 'd'])
})

describe('serverGroups', () => {
  const all = servers.map((server) => ({ server, link: linkFor(server) }))
  test('before typing, only the current server shows its tabs and actions', () => {
    expect(serverGroups(all, 'creative', '').map((g) => g.id)).toEqual([
      'servers',
      'server-creative',
    ])
    expect(serverGroups(all, null, '').map((g) => g.id)).toEqual(['servers'])
  })
  test('typing shows every server, labelled with its name', () => {
    const groups = serverGroups(all, null, 'back')
    expect(groups[0]!.id).toBe('servers')
    expect(groups).toHaveLength(4)
    expect(groups[1]!.items.map((i) => i.label)).toContain('Survival › Back up now')
  })
  test('several words put the tabs and actions before the servers', () => {
    const ids = serverGroups(all, null, 'survival files').map((g) => g.id)
    expect(ids.at(-1)).toBe('servers')
  })
})
