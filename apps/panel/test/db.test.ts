import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { migrate, openDb, schema } from '../server/db'
import { migrations } from '../server/db/migrations.gen'

const fresh = () => openDb(':memory:')

describe('database', () => {
  it('applies migrations once', () => {
    const db = fresh()
    expect(migrate(db.$client)).toEqual([])
    const tables = db.$client
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((t) => t.name)
    for (const t of [
      'users',
      'credentials',
      'recovery_codes',
      'setup_token',
      'servers',
      'jobs',
      'audit',
    ]) {
      expect(tables).toContain(t)
    }
  })

  it('bundled migrations match the SQL files on disk', async () => {
    for (const m of migrations) {
      const onDisk = await Bun.file(
        new URL(`../server/db/migrations/${m.tag}.sql`, import.meta.url),
      ).text()
      expect(m.sql).toBe(onDisk)
    }
  })

  it('cascades a user delete to passkeys and recovery codes', () => {
    const db = fresh()
    const [u] = db.insert(schema.users).values({ name: 'Matt' }).returning().all()
    db.insert(schema.credentials)
      .values({ id: 'cred1', userId: u!.id, publicKey: Buffer.from([1, 2]), nickname: 'iPhone' })
      .run()
    db.insert(schema.recoveryCodes).values({ userId: u!.id, hash: 'x' }).run()
    db.delete(schema.users).where(eq(schema.users.id, u!.id)).run()
    expect(db.select().from(schema.credentials).all()).toEqual([])
    expect(db.select().from(schema.recoveryCodes).all()).toEqual([])
  })

  it('refuses two servers on one port', () => {
    const db = fresh()
    const base = {
      displayName: 'S',
      loader: 'fabric' as const,
      mcVersion: '26.3',
      javaMajor: 25,
      memoryMb: 4096,
      rconPassword: 'p',
      eulaAcceptedAt: new Date(),
    }
    db.insert(schema.servers)
      .values({ ...base, name: 'a', port: 25565, rconPort: 25575 })
      .run()
    expect(() =>
      db
        .insert(schema.servers)
        .values({ ...base, name: 'b', port: 25565, rconPort: 25576 })
        .run(),
    ).toThrow()
  })

  it('ticks crash alerts on channels that already take problem alerts', () => {
    const sqlite = new Database(':memory:')
    const before = migrations.filter((m) => m.tag < '0009')
    migrate(sqlite, before)
    const add = sqlite.prepare(
      "INSERT INTO notify_channels (name, kind, url_sealed, target, events) VALUES (?, 'ntfy', 'x', 't', ?)",
    )
    add.run('problems', JSON.stringify(['backup.failed', 'update.flytower']))
    add.run('chatter', JSON.stringify(['player.joined']))
    migrate(sqlite)
    const events = Object.fromEntries(
      sqlite
        .query<{ name: string; events: string }, []>('SELECT name, events FROM notify_channels')
        .all()
        .map((r) => [r.name, (JSON.parse(r.events) as string[]).sort()]),
    )
    expect(events.problems).toEqual([
      'backup.failed',
      'schedule.failed',
      'server.crash_loop',
      'server.crashed',
      'server.unresponsive',
      'update.flytower',
    ])
    expect(events.chatter).toEqual(['player.joined'])
  })
})

describe('migration runner', () => {
  const setup = () => {
    const sqlite = new Database(':memory:', { strict: true })
    sqlite.run('PRAGMA foreign_keys = ON')
    migrate(sqlite, [
      {
        tag: 'a',
        sql: 'CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT);\n--> statement-breakpoint\nCREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE CASCADE);',
      },
    ])
    sqlite.run("INSERT INTO parent (id, name) VALUES (1, 'p')")
    sqlite.run('INSERT INTO child (id, parent_id) VALUES (10, 1)')
    return sqlite
  }

  it('keeps child rows through a table rebuild', () => {
    const sqlite = setup()
    migrate(sqlite, [
      { tag: 'a', sql: '' },
      {
        tag: 'b',
        sql: [
          'CREATE TABLE __new_parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL)',
          'INSERT INTO __new_parent SELECT id, name FROM parent',
          'DROP TABLE parent',
          'ALTER TABLE __new_parent RENAME TO parent',
        ].join(';\n--> statement-breakpoint\n'),
      },
    ])
    expect(sqlite.query('SELECT id FROM child').all()).toEqual([{ id: 10 }])
    expect(sqlite.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })

  it('rolls back a migration that leaves broken references', () => {
    const sqlite = setup()
    expect(() =>
      migrate(sqlite, [
        { tag: 'a', sql: '' },
        { tag: 'c', sql: 'DELETE FROM parent' },
      ]),
    ).toThrow('Migration c left broken references (child -> parent).')
    expect(sqlite.query('SELECT id FROM parent').all()).toEqual([{ id: 1 }])
    expect(sqlite.query("SELECT tag FROM __flytower_migrations WHERE tag = 'c'").all()).toEqual([])
    expect(sqlite.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })
})
