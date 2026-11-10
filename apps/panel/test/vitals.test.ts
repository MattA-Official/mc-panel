import { describe, expect, test } from 'bun:test'
import { cpuLevel, memoryLevel, tickLevel, vitals } from '../shared/vitals'

describe('tickLevel', () => {
  test('is fine up to 40 ms, busy to 50 ms, then struggling', () => {
    expect(tickLevel(12).level).toBe('ok')
    expect(tickLevel(40).level).toBe('ok')
    expect(tickLevel(45).level).toBe('busy')
    expect(tickLevel(50).level).toBe('busy')
    expect(tickLevel(63).level).toBe('struggling')
    expect(tickLevel(null)).toMatchObject({ value: null, level: 'ok' })
  })
})

describe('memoryLevel', () => {
  test('is busy over 90% of the limit', () => {
    expect(memoryLevel(5000, 6000).level).toBe('ok')
    expect(memoryLevel(5500, 6000).level).toBe('busy')
    expect(memoryLevel(5500, 6000).limitMb).toBe(6000)
  })
})

describe('cpuLevel', () => {
  test('is busy only after five high minutes in a row', () => {
    expect(cpuLevel([90, 90, 90, 90]).level).toBe('ok')
    expect(cpuLevel([90, 90, 90, 90, 90]).level).toBe('busy')
    expect(cpuLevel([90, 90, 50, 90, 90, 90]).level).toBe('ok')
    expect(cpuLevel([90, 90, 90, null, 90]).level).toBe('ok')
    expect(cpuLevel([]).value).toBeNull()
  })
})

describe('vitals', () => {
  const now = Date.UTC(2026, 10, 10, 18, 30, 20)
  const minute = (ago: number) => Math.floor(now / 60_000) * 60 - ago * 60

  test('reads the latest sample and lays tick time out per minute', () => {
    const v = vitals(
      [
        { at: minute(2), cpu: 20, memMb: 3000, mspt: 10 },
        { at: minute(0), cpu: 30, memMb: 3100, mspt: 55 },
      ],
      4000,
      now,
    )!
    expect(v.tick).toMatchObject({ value: 55, level: 'struggling' })
    expect(v.memory).toMatchObject({ value: 3100, level: 'ok', limitMb: 4000 })
    expect(v.cpu.value).toBe(30)
    expect(v.spark).toHaveLength(60)
    expect(v.spark.at(-1)).toBe(55)
    expect(v.spark.at(-2)).toBeNull()
    expect(v.spark.at(-3)).toBe(10)
  })

  test('is null with no recent sample', () => {
    expect(vitals([], 4000, now)).toBeNull()
    expect(vitals([{ at: minute(10), cpu: 1, memMb: 1, mspt: 1 }], 4000, now)).toBeNull()
  })
})
