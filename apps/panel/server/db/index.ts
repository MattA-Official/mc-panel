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
  const ran: string[] = []
  for (const m of migrations) {
    if (applied.has(m.tag)) continue
    sqlite.transaction(() => {
      for (const statement of m.sql.split('--> statement-breakpoint')) {
        if (statement.trim()) sqlite.run(statement)
      }
      sqlite.run('INSERT INTO __flytower_migrations (tag, applied_at) VALUES (?, ?)', [
        m.tag,
        Date.now(),
      ])
    })()
    ran.push(m.tag)
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
