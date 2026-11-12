import { describe, expect, it } from 'bun:test'
import { openDb, schema } from '../server/db'
import { pruneOld } from '../server/db/retention'

const DAY = 24 * 3600_000
const now = Date.parse('2026-11-12T04:17:00Z')
const ago = (days: number) => new Date(now - days * DAY)

describe('retention', () => {
  it('clears old activity, sooner for scheduled runs', () => {
    const db = openDb(':memory:')
    const [u] = db.insert(schema.users).values({ name: 'Matt' }).returning().all()
    db.insert(schema.audit)
      .values([
        { at: ago(400), action: 'server.start', target: 'survival', userId: u!.id },
        { at: ago(200), action: 'server.start', target: 'survival', userId: u!.id },
        { at: ago(100), action: 'schedule.run', target: 'survival', userId: null },
        { at: ago(100), action: 'schedule.run', target: 'survival', userId: u!.id },
        { at: ago(10), action: 'schedule.run', target: 'survival', userId: null },
      ])
      .run()
    expect(pruneOld(db, now).audit).toBe(2)
    expect(
      db
        .select({ action: schema.audit.action, userId: schema.audit.userId })
        .from(schema.audit)
        .all(),
    ).toEqual([
      { action: 'server.start', userId: u!.id },
      { action: 'schedule.run', userId: u!.id },
      { action: 'schedule.run', userId: null },
    ])
  })

  it('clears finished jobs after a month, never unfinished ones', () => {
    const db = openDb(':memory:')
    db.insert(schema.jobs)
      .values([
        { kind: 'create', state: 'succeeded', createdAt: ago(40), finishedAt: ago(40) },
        { kind: 'create', state: 'failed', createdAt: ago(40), finishedAt: ago(40) },
        { kind: 'create', state: 'succeeded', createdAt: ago(5), finishedAt: ago(5) },
        { kind: 'create', state: 'running', createdAt: ago(40) },
        { kind: 'create', state: 'queued', createdAt: ago(40) },
      ])
      .run()
    expect(pruneOld(db, now).jobs).toBe(2)
    expect(db.select({ state: schema.jobs.state }).from(schema.jobs).all()).toEqual([
      { state: 'succeeded' },
      { state: 'running' },
      { state: 'queued' },
    ])
  })
})
