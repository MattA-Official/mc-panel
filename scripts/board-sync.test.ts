import { describe, expect, test } from 'bun:test'
import { desiredDates, desiredStatus, pickCurrentMilestone, type Item } from './board-sync'

const M = '1.1.0 Alerts and reliability'
const item = (over: Partial<Item>): Item => ({
  kind: 'Issue',
  number: 1,
  state: 'OPEN',
  milestone: null,
  status: null,
  ...over,
})

describe('desiredStatus', () => {
  test('closed and merged items are Done', () => {
    expect(desiredStatus(item({ state: 'CLOSED' }), M)).toBe('Done')
    expect(
      desiredStatus(item({ kind: 'PullRequest', state: 'MERGED', status: 'In review' }), M),
    ).toBe('Done')
    expect(desiredStatus(item({ state: 'CLOSED', status: 'Done' }), M)).toBeNull()
  })

  test('open pull requests are In review', () => {
    expect(desiredStatus(item({ kind: 'PullRequest' }), M)).toBe('In review')
  })

  test('open issues go to Todo in the current milestone, Backlog otherwise', () => {
    expect(desiredStatus(item({ milestone: M }), M)).toBe('Todo')
    expect(desiredStatus(item({ milestone: '1.2.0 People and sharing' }), M)).toBe('Backlog')
    expect(desiredStatus(item({}), M)).toBe('Backlog')
    expect(desiredStatus(item({ milestone: M }), null)).toBe('Backlog')
  })

  test('cards moved by hand to In progress or In review stay put', () => {
    expect(desiredStatus(item({ status: 'In progress' }), M)).toBeNull()
    expect(desiredStatus(item({ status: 'In review' }), M)).toBeNull()
  })

  test('a reopened item leaves Done', () => {
    expect(desiredStatus(item({ status: 'Done', milestone: M }), M)).toBe('Todo')
  })

  test('nothing to do when the Status is already right', () => {
    expect(desiredStatus(item({ status: 'Backlog' }), M)).toBeNull()
  })
})

describe('pickCurrentMilestone', () => {
  test('picks the lowest version and ignores unversioned milestones', () => {
    expect(
      pickCurrentMilestone(['Future', '1.2.0 People', '1.10.0 Later', M, 'Website launch']),
    ).toBe(M)
  })
  test('null when nothing is versioned', () => {
    expect(pickCurrentMilestone(['Future'])).toBeNull()
  })
})

describe('desiredDates', () => {
  test('Start date is the day it was opened, in the UK', () => {
    // 23:30 UTC in summer is already the next day in London.
    expect(desiredDates(item({ createdAt: '2026-07-01T23:30:00Z' }))).toEqual({
      start: '2026-07-02',
    })
  })

  test('a Start date set by hand stays', () => {
    expect(desiredDates(item({ createdAt: '2026-11-01T10:00:00Z', start: '2026-10-01' }))).toEqual(
      {},
    )
  })

  test('closed items take the day they closed as Target date, even over a hand-set one', () => {
    const closed = item({
      state: 'MERGED',
      createdAt: '2026-11-09T10:00:00Z',
      closedAt: '2026-11-10T09:00:00Z',
      target: '2026-12-01',
    })
    expect(desiredDates(closed)).toEqual({ start: '2026-11-09', target: '2026-11-10' })
  })

  test('open items aim at their milestone, unless a Target date is set by hand', () => {
    expect(
      desiredDates(item({ milestoneDue: '2026-12-01T08:00:00Z', start: '2026-11-01' })),
    ).toEqual({ target: '2026-12-01' })
    expect(
      desiredDates(
        item({ milestoneDue: '2026-12-01T08:00:00Z', start: '2026-11-01', target: '2026-11-20' }),
      ),
    ).toEqual({})
    expect(desiredDates(item({ start: '2026-11-01' }))).toEqual({})
  })
})
