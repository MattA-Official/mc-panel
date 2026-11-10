import { describe, expect, it } from 'bun:test'
import { CronTimers, nextRun, type Clock } from '../server/schedules/timers'

/** A clock that only moves when told to, firing timers as it passes them. */
function fakeClock(start: string) {
  let now = Date.parse(start)
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const clock: Clock = {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++seq
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimer: (h) => void timers.delete(h as number),
  }
  return {
    clock,
    pending: () => timers.size,
    advance(ms: number) {
      const end = now + ms
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = end
    },
    get now() {
      return new Date(now).toISOString()
    },
  }
}

describe('nextRun', () => {
  it('reads the expression in the given time zone', () => {
    const from = Date.parse('2026-07-01T00:00:00Z')
    expect(nextRun('0 5 * * *', 'UTC', from)?.toISOString()).toBe('2026-07-01T05:00:00.000Z')
    // 05:00 in London in summer is 04:00 UTC.
    expect(nextRun('0 5 * * *', 'Europe/London', from)?.toISOString()).toBe(
      '2026-07-01T04:00:00.000Z',
    )
  })

  it('gives readable errors', () => {
    expect(() => nextRun('0 5 * *', 'UTC')).toThrow("That schedule isn't valid")
    expect(() => nextRun('0 5 * * *', 'Mars/Olympus')).toThrow('Unknown time zone Mars/Olympus.')
  })
})

describe('CronTimers', () => {
  it('fires each run and arms the next', () => {
    const c = fakeClock('2026-07-01T00:00:00Z')
    const timers = new CronTimers(c.clock)
    const fired: string[] = []
    timers.sync([
      { key: 'a', cron: '0 5 * * *', tz: 'UTC', fire: (at) => fired.push(at.toISOString()) },
    ])
    expect(timers.next('a')?.toISOString()).toBe('2026-07-01T05:00:00.000Z')
    c.advance(2 * 86_400_000)
    expect(fired).toEqual(['2026-07-01T05:00:00.000Z', '2026-07-02T05:00:00.000Z'])
    expect(timers.next('a')?.toISOString()).toBe('2026-07-03T05:00:00.000Z')
  })

  it('fires early by the lead time, passing the run it is for', () => {
    const c = fakeClock('2026-07-01T00:00:00Z')
    const timers = new CronTimers(c.clock)
    const fired: [string, string][] = []
    timers.sync([
      {
        key: 'r',
        cron: '0 5 * * *',
        tz: 'UTC',
        leadMs: 15 * 60_000,
        fire: (at) => fired.push([c.now, at.toISOString()]),
      },
    ])
    c.advance(86_400_000)
    expect(fired).toEqual([['2026-07-01T04:45:00.000Z', '2026-07-01T05:00:00.000Z']])
  })

  it('skips a run whose early start has already passed', () => {
    const c = fakeClock('2026-07-01T04:50:00Z')
    const timers = new CronTimers(c.clock)
    timers.sync([{ key: 'r', cron: '0 5 * * *', tz: 'UTC', leadMs: 15 * 60_000, fire: () => {} }])
    expect(timers.next('r')?.toISOString()).toBe('2026-07-02T05:00:00.000Z')
  })

  it('re-arms only entries whose schedule changed, and drops removed ones', () => {
    const c = fakeClock('2026-07-01T00:00:00Z')
    const timers = new CronTimers(c.clock)
    const fired: string[] = []
    timers.sync([
      { key: 'a', cron: '0 5 * * *', tz: 'UTC', fire: () => fired.push('a1') },
      { key: 'b', cron: '0 6 * * *', tz: 'UTC', fire: () => fired.push('b') },
    ])
    timers.sync([{ key: 'a', cron: '0 5 * * *', tz: 'UTC', fire: () => fired.push('a2') }])
    expect(timers.keys()).toEqual(['a'])
    expect(c.pending()).toBe(1)
    c.advance(86_400_000)
    // The newest callback runs, and b never does.
    expect(fired).toEqual(['a2'])
  })

  it('waits in steps when the next run is months away', () => {
    const c = fakeClock('2026-01-02T00:00:00Z')
    const timers = new CronTimers(c.clock)
    const fired: string[] = []
    timers.sync([
      { key: 'y', cron: '0 0 1 1 *', tz: 'UTC', fire: (at) => fired.push(at.toISOString()) },
    ])
    c.advance(366 * 86_400_000)
    expect(fired).toEqual(['2027-01-01T00:00:00.000Z'])
  })

  it('keeps going when a callback throws', () => {
    const c = fakeClock('2026-07-01T00:00:00Z')
    const timers = new CronTimers(c.clock)
    let n = 0
    timers.sync([
      {
        key: 'x',
        cron: '0 * * * *',
        tz: 'UTC',
        fire: () => {
          n++
          throw new Error('boom')
        },
      },
    ])
    const err = console.error
    console.error = () => {}
    c.advance(3 * 3_600_000)
    console.error = err
    expect(n).toBe(3)
  })
})
