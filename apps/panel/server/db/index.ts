import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { migrations as bundled } from './migrations.gen'
import * as schema from './schema'

export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database }

/** The database or a transaction on it; helpers that may run inside a transaction take this. */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

export interface Migration {
  tag: string
  sql: string
}

/**
 * Applies migrations in order, each in its own transaction, recording what ran in
 * `__flytower_migrations`. Already-applied tags are skipped, so this is safe on every boot.
 *
 * Foreign keys are off while a migration runs. SQLite ignores `PRAGMA foreign_keys` inside a
 * transaction, so it has to be set around it, and with it on, a table rebuild (create new,
 * copy, drop old, rename) would cascade-delete every row that points at the old table.
 * `foreign_key_check` runs before each commit instead, so a migration that leaves a broken
 * reference is rolled back rather than kept.
 */
export function migrate(sqlite: Database, migrations: Migration[] = bundled): string[] {
  sqlite.run(
    'CREATE TABLE IF NOT EXISTS __flytower_migrations (tag TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  )
  const applied = new Set(
    sqlite
      .query<{ tag: string }, []>('SELECT tag FROM __flytower_migrations')
      .all()
      .map((r) => r.tag),
  )
  const pending = migrations.filter((m) => !applied.has(m.tag))
  if (!pending.length) return []
  const fkWasOn =
    sqlite.query<{ foreign_keys: number }, []>('PRAGMA foreign_keys').get()?.foreign_keys === 1
  sqlite.run('PRAGMA foreign_keys = OFF')
  const ran: string[] = []
  try {
    for (const m of pending) {
      sqlite.transaction(() => {
        for (const statement of m.sql.split('--> statement-breakpoint')) {
          if (statement.trim()) sqlite.run(statement)
        }
        const broken = sqlite
          .query<{ table: string; parent: string }, []>('PRAGMA foreign_key_check')
          .all()
        if (broken.length) {
          const where = [...new Set(broken.map((b) => `${b.table} -> ${b.parent}`))].join(', ')
          throw new Error(`Migration ${m.tag} left broken references (${where}).`)
        }
        sqlite.run('INSERT INTO __flytower_migrations (tag, applied_at) VALUES (?, ?)', [
          m.tag,
          Date.now(),
        ])
      })()
      ran.push(m.tag)
    }
  } finally {
    if (fkWasOn) sqlite.run('PRAGMA foreign_keys = ON')
  }
  return ran
}

/** Opens (creating if needed) the panel database and brings its schema up to date. */
export function openDb(path: string, migrations?: Migration[]): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const sqlite = new Database(path, { create: true, strict: true })
  sqlite.run('PRAGMA journal_mode = WAL')
  sqlite.run('PRAGMA foreign_keys = ON')
  sqlite.run('PRAGMA busy_timeout = 5000')
  migrate(sqlite, migrations)
  return drizzle(sqlite, { schema }) as Db
}

export { schema }
