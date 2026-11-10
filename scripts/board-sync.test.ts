import { describe, expect, test } from 'bun:test'
import { desiredStatus, pickCurrentMilestone, type Item } from './board-sync'

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
