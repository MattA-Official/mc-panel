import { describe, expect, test } from 'bun:test'
import { STATUS, VIEWS, areaOptions, missingOptions, viewBody } from './board-setup'

describe('missingOptions', () => {
  test("GitHub's default Status needs Backlog, In progress (lower case) and In review", () => {
    expect(missingOptions(['Todo', 'In Progress', 'Done'], STATUS).map((o) => o.name)).toEqual([
      'Backlog',
      'In progress',
      'In review',
    ])
  })

  test('nothing is missing once set up', () => {
    expect(
      missingOptions(
        STATUS.map((o) => o.name),
        STATUS,
      ),
    ).toEqual([])
  })
})

describe('areaOptions', () => {
  test('one option per area: label', () => {
    expect(areaOptions(['area:agent', 'type:bug', 'area:panel']).map((o) => o.name)).toEqual([
      'agent',
      'panel',
    ])
  })
})

describe('viewBody', () => {
  const ids = new Map([
    ['Title', 1],
    ['Status', 2],
    ['Priority', 3],
    ['Milestone', 4],
  ])

  test('turns field names into IDs and drops unknown ones', () => {
    const active = VIEWS.find((v) => v.name === 'Active')!
    expect(viewBody(active, ids)).toEqual({
      name: 'Active',
      layout: 'table',
      filter: 'status:Todo,"In progress","In review"',
      visible_fields: [1, 2, 3, 4],
      group_by: [2],
      sort_by: [[3, 'asc']],
    })
  })

  test('the board view puts Status in columns', () => {
    const board = VIEWS.find((v) => v.name === 'Board')!
    expect(viewBody(board, ids).vertical_group_by).toEqual([2])
  })

  test('a roadmap has no visible fields', () => {
    const roadmap = VIEWS.find((v) => v.name === 'Roadmap')!
    expect(viewBody(roadmap, ids).visible_fields).toBeUndefined()
  })

  test('every view has a unique name', () => {
    expect(new Set(VIEWS.map((v) => v.name)).size).toBe(VIEWS.length)
  })
})
