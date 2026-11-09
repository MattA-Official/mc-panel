import type { ContentItem } from '../../shared/spec'
import { sql } from 'drizzle-orm'
import { blob, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const now = sql`(unixepoch() * 1000)`
const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  createdAt: createdAt(),
})

/** One row per registered passkey. */
export const credentials = sqliteTable('credentials', {
  id: text('id').primaryKey(), // WebAuthn credential id, base64url
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  publicKey: blob('public_key', { mode: 'buffer' }).notNull(),
  counter: integer('counter').notNull().default(0),
  transports: text('transports', { mode: 'json' }).$type<string[]>().notNull().default([]),
  aaguid: text('aaguid'),
  nickname: text('nickname').notNull(),
  createdAt: createdAt(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
})

/** One-time recovery codes, stored only as Bun.password hashes. */
export const recoveryCodes = sqliteTable('recovery_codes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  hash: text('hash').notNull(),
  usedAt: integer('used_at', { mode: 'timestamp_ms' }),
})

/** The installer's setup token. At most one row (id = 1). */
export const setupToken = sqliteTable('setup_token', {
  id: integer('id').primaryKey(),
  hash: text('hash').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  usedAt: integer('used_at', { mode: 'timestamp_ms' }),
})

export const servers = sqliteTable(
  'servers',
  {
    name: text('name').primaryKey(),
    displayName: text('display_name').notNull(),
    loader: text('loader', { enum: ['vanilla', 'fabric'] }).notNull(),
    mcVersion: text('mc_version').notNull(),
    loaderVersion: text('loader_version'),
    javaMajor: integer('java_major').notNull(),
    memoryMb: integer('memory_mb').notNull(),
    port: integer('port').notNull(),
    rconPort: integer('rcon_port').notNull(),
    rconPassword: text('rcon_password').notNull(),
    /** The address players use, like survival.example.com; lower case. */
    hostname: text('hostname'),
    eulaAcceptedAt: integer('eula_accepted_at', { mode: 'timestamp_ms' }).notNull(),
    /** 5-field cron expression for scheduled backups; null means off. */
    backupSchedule: text('backup_schedule'),
    /** IANA time zone the schedule is read in, e.g. Europe/London. */
    backupTz: text('backup_tz').notNull().default('UTC'),
    keepLast: integer('keep_last').notNull().default(6),
    keepDaily: integer('keep_daily').notNull().default(7),
    keepWeekly: integer('keep_weekly').notNull().default(4),
    /** The spec's content list as written; the lockfile in the server folder pins it. */
    content: text('content', { mode: 'json' }).$type<ContentItem[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('servers_port').on(t.port),
    uniqueIndex('servers_rcon_port').on(t.rconPort),
    uniqueIndex('servers_hostname').on(t.hostname),
  ],
)

export const backups = sqliteTable(
  'backups',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    server: text('server').notNull(),
    /** File name inside the server's backup folder. */
    file: text('file').notNull(),
    bytes: integer('bytes').notNull(),
    kind: text('kind', { enum: ['manual', 'scheduled', 'safety'] }).notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('backups_file').on(t.server, t.file)],
)

export const exports = sqliteTable('exports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  server: text('server').notNull(),
  file: text('file').notNull(),
  bytes: integer('bytes').notNull(),
  createdAt: createdAt(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
})

export const shares = sqliteTable(
  'shares',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    exportId: integer('export_id')
      .notNull()
      .references(() => exports.id, { onDelete: 'cascade' }),
    /** SHA-256 of the token, hex. The token itself is only ever shown once. */
    tokenHash: text('token_hash').notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    downloads: integer('downloads').notNull().default(0),
  },
  (t) => [uniqueIndex('shares_token').on(t.tokenHash)],
)

export const jobs = sqliteTable('jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull(),
  server: text('server'),
  state: text('state', { enum: ['queued', 'running', 'succeeded', 'failed'] })
    .notNull()
    .default('queued'),
  step: text('step'),
  progress: integer('progress').notNull().default(0), // 0..100
  message: text('message'),
  createdAt: createdAt(),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
})

export const audit = sqliteTable('audit', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: integer('at', { mode: 'timestamp_ms' }).notNull().default(now),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  target: text('target'),
  detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>(),
})
