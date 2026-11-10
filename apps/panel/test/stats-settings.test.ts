import { describe, expect, it } from 'bun:test'
import {
  describeStats,
  isDefaultStats,
  readStatsSettings,
  sameStatsSettings,
  StatsSettings,
} from '../shared/stats-settings'

const steve = { uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', name: 'Steve' }
const alex = { uuid: '853c80ef-3c37-49fd-aa49-938b674adae6', name: 'Alex' }

describe('stats settings', () => {
  it('is on with nobody left out until set', () => {
    expect(readStatsSettings(null)).toEqual({ enabled: true, leaveOut: [] })
    expect(readStatsSettings({ enabled: 'nope' })).toEqual({ enabled: true, leaveOut: [] })
    expect(isDefaultStats(readStatsSettings(null))).toBe(true)
  })

  it('lower-cases UUIDs and refuses ones that are not', () => {
    expect(
      StatsSettings.parse({ leaveOut: [{ ...steve, uuid: steve.uuid.toUpperCase() }] }),
    ).toEqual({ enabled: true, leaveOut: [steve] })
    expect(StatsSettings.safeParse({ leaveOut: [{ uuid: 'Steve', name: 'Steve' }] }).success).toBe(
      false,
    )
  })

  it('compares by UUID, in any order, and ignores renames', () => {
    const a = { enabled: true, leaveOut: [steve, alex] }
    expect(sameStatsSettings(a, { enabled: true, leaveOut: [alex, steve] })).toBe(true)
    expect(
      sameStatsSettings(a, { enabled: true, leaveOut: [alex, { ...steve, name: 'Steve2' }] }),
    ).toBe(true)
    expect(sameStatsSettings(a, { enabled: false, leaveOut: [steve, alex] })).toBe(false)
    expect(sameStatsSettings(a, { enabled: true, leaveOut: [steve] })).toBe(false)
  })

  it('describes itself in a few words', () => {
    expect(describeStats({ enabled: true, leaveOut: [] })).toBe('On')
    expect(describeStats({ enabled: true, leaveOut: [steve, alex] })).toBe('On, 2 players left out')
    expect(describeStats({ enabled: false, leaveOut: [steve] })).toBe('Off')
  })
})
