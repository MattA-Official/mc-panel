import { describe, expect, it } from 'bun:test'
import {
  addEntry,
  commandFailed,
  commandFor,
  entryFor,
  mcDate,
  parseList,
  removeEntry,
  withUuids,
} from '../server/players'
import { offlineUuid } from '@flytower/providers'

describe('players', () => {
  it('parses list replies', () => {
    expect(parseList('There are 0 of a max of 20 players online: ')).toEqual({
      count: 0,
      max: 20,
      names: [],
    })
    expect(parseList('There are 2 of a max of 20 players online: Steve, Alex')).toEqual({
      count: 2,
      max: 20,
      names: ['Steve', 'Alex'],
    })
    expect(parseList('Unknown command')).toBeNull()
  })

  it('builds commands and spots failures', () => {
    expect(commandFor('ban', 'Steve', 'griefing\nspawn')).toBe('ban Steve griefing spawn')
    expect(commandFor('whitelist-add', 'Alex')).toBe('whitelist add Alex')
    expect(commandFailed('That player does not exist')).toBe(true)
    expect(commandFailed('Nothing changed. The player is already whitelisted')).toBe(true)
    expect(commandFailed('Added Alex to the whitelist')).toBe(false)
  })

  it('edits list files without duplicates', () => {
    const steve = { uuid: 'u1', name: 'Steve' }
    let list = addEntry([], entryFor('whitelist.json', steve))
    list = addEntry(list, entryFor('whitelist.json', { uuid: 'u1', name: 'steve' }))
    expect(list).toEqual([steve])
    expect(removeEntry(list, 'STEVE')).toEqual([])
    expect(entryFor('ops.json', steve)).toMatchObject({ level: 4 })
    expect(
      entryFor('banned-players.json', steve, { now: new Date(Date.UTC(2026, 10, 9, 13, 5, 1)) }),
    ).toMatchObject({ created: '2026-11-09 13:05:01 +0000', expires: 'forever' })
    expect(mcDate(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe('2026-01-02 03:04:05 +0000')
  })
})

describe('online players', () => {
  it('finds UUIDs in usercache.json, case-insensitively', () => {
    const cache = [
      { name: 'Notch', uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', expiresOn: '2026-12-01' },
      { junk: true },
    ]
    expect(withUuids(['notch', 'Stranger'], cache)).toEqual([
      { name: 'notch', uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5' },
      { name: 'Stranger', uuid: offlineUuid('Stranger') },
    ])
    expect(withUuids(['Alex'], 'not a list')).toEqual([{ name: 'Alex', uuid: offlineUuid('Alex') }])
  })
})
