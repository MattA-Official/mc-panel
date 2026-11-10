import type { ContentItem } from '../../shared/spec'
import type { PublicPage } from '../../shared/public-page'
import { sql } from 'drizzle-orm'
import {
  blob,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

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
    loader: text('loader', { enum: ['vanilla', 'fabric', 'paper'] }).notNull(),
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
    /** Where backups are copied off the machine; null keeps them local only. */
    offsiteTarget: integer('offsite_target'),
    /** The spec's content list as written; the lockfile in the server folder pins it. */
    content: text('content', { mode: 'json' }).$type<ContentItem[]>().notNull().default([]),
    /** Restart once, automatically, when the console stops answering for five minutes. */
    restartWhenUnresponsive: integer('restart_when_unresponsive', { mode: 'boolean' })
      .notNull()
      .default(false),
    /** IANA time zone the server's scheduled tasks are read in. */
    timezone: text('timezone').notNull().default('UTC'),
    /** The public status page's settings; null until it's first set. */
    publicPage: text('public_page', { mode: 'json' }).$type<PublicPage>(),
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
    /** Kept forever: pruning never deletes it, e.g. the last backup before a world reset. */
    kept: integer('kept', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    /** The off-site copy: null when the server has no target. */
    offsiteState: text('offsite_state', { enum: ['pending', 'uploading', 'done', 'failed'] }),
    offsiteTarget: integer('offsite_target'),
    offsiteKey: text('offsite_key'),
    offsiteError: text('offsite_error'),
    offsiteAttempts: integer('offsite_attempts').notNull().default(0),
    offsiteAt: integer('offsite_at', { mode: 'timestamp_ms' }),
  },
  (t) => [uniqueIndex('backups_file').on(t.server, t.file)],
)

export const exports = sqliteTable('exports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  server: text('server').notNull(),
  file: text('file').notNull(),
  bytes: integer('bytes').notNull(),
  createdAt: createdAt(),
  /** Ignored for past worlds, which never expire. */
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  /** Set for a past world: the old world kept when the world was reset. */
  name: text('name'),
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

/**
 * One sample a minute per running server, and for the machine as a whole (server "*").
 * A server with no row for a minute was stopped then, so the charts show a gap.
 */
export const metrics = sqliteTable(
  'metrics',
  {
    server: text('server').notNull(),
    at: integer('at').notNull(), // unix seconds, on the minute
    cpu: real('cpu'), // percent of the whole machine
    memMb: integer('mem_mb'),
    players: integer('players'),
    mspt: real('mspt'), // milliseconds per tick
    diskMb: integer('disk_mb'), // machine only: used on the servers' disk
  },
  (t) => [primaryKey({ columns: [t.server, t.at] })],
)

/** S3-compatible storage that backups are copied to. The secret is encrypted at rest. */
export const backupTargets = sqliteTable(
  'backup_targets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    endpoint: text('endpoint').notNull(),
    region: text('region').notNull().default('auto'),
    bucket: text('bucket').notNull(),
    prefix: text('prefix').notNull().default('flytower'),
    accessKeyId: text('access_key_id').notNull(),
    secretSealed: text('secret_sealed').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('backup_targets_name').on(t.name)],
)

/** Panel-wide settings, one row per key, with JSON values. See server/settings.ts. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
})

/**
 * Where notifications go: a Discord webhook, an ntfy topic or a JSON webhook. The URL (which
 * holds the Discord token) and the ntfy token or webhook signing secret are sealed at rest.
 */
export const notifyChannels = sqliteTable(
  'notify_channels',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['discord', 'ntfy', 'webhook'] }).notNull(),
    urlSealed: text('url_sealed').notNull(),
    /** ntfy access token, or the webhook's signing secret. */
    secretSealed: text('secret_sealed'),
    /** The URL with its secret parts masked, for telling channels apart. */
    target: text('target').notNull(),
    events: text('events', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /** Server names; empty means every server. */
    servers: text('servers', { mode: 'json' }).$type<string[]>().notNull().default([]),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    lastSentAt: integer('last_sent_at', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),
    lastErrorAt: integer('last_error_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('notify_channels_name').on(t.name)],
)

/**
 * What has been sent, so the same alert isn't repeated within its quiet period and a "back to
 * normal" message follows a problem. Keyed by kind and server, e.g. `backup.failed:survival`.
 */
export const notifyState = sqliteTable('notify_state', {
  key: text('key').primaryKey(),
  sentAt: integer('sent_at', { mode: 'timestamp_ms' }).notNull(),
  /** A problem that hasn't cleared yet. */
  open: integer('open', { mode: 'boolean' }).notNull().default(false),
  /** Kind-specific memory, like the disk level last warned about or the versions offered. */
  value: text('value'),
})

/**
 * Crashes and other trouble Flytower noticed, per server, kept for 30 days. A crash keeps
 * the crash report's file name (in the server's crash-reports folder) and the last lines
 * of the log, since the log is rotated when the server starts again.
 */
export const serverEvents = sqliteTable(
  'server_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    server: text('server').notNull(),
    at: integer('at', { mode: 'timestamp_ms' }).notNull().default(now),
    kind: text('kind', {
      enum: ['crash', 'oom', 'crash-loop', 'unresponsive', 'recovered'],
    }).notNull(),
    /** A sentence on the cause, like "Exited with code 1" or the crash report's description. */
    cause: text('cause'),
    /** systemd's Result for the run that ended, like `exit-code` or `oom-kill`. */
    result: text('result'),
    exitStatus: integer('exit_status'),
    /** The crash report's file name, if Minecraft wrote one. */
    crashReport: text('crash_report'),
    logTail: text('log_tail', { mode: 'json' }).$type<string[]>(),
    /** When someone closed its banner. */
    dismissedAt: integer('dismissed_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('server_events_server_at').on(t.server, t.at)],
)

/**
 * What the background update check last found, per thing checked: `('flytower', '*')`,
 * `('content', <server>)`, `('minecraft', <server>)` or `('java', <major>)`. A failed check
 * sets only the error, so the last good result (and its badge) stays.
 */
export const updateStatus = sqliteTable(
  'update_status',
  {
    scope: text('scope', { enum: ['flytower', 'content', 'minecraft', 'java'] }).notNull(),
    subject: text('subject').notNull(),
    /** The last good result; its shape depends on the scope. */
    summary: text('summary', { mode: 'json' }).$type<unknown>(),
    checkedAt: integer('checked_at', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),
    errorAt: integer('error_at', { mode: 'timestamp_ms' }),
  },
  (t) => [primaryKey({ columns: [t.scope, t.subject] })],
)

/**
 * Restarts, console commands and announcements a server runs on a schedule, in its own time
 * zone (servers.timezone). The spec's `schedules` list, in order, plus each task's last run.
 */
export const schedules = sqliteTable(
  'schedules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    server: text('server').notNull(),
    position: integer('position').notNull().default(0),
    kind: text('kind', { enum: ['restart', 'command', 'announce'] }).notNull(),
    cron: text('cron').notNull(),
    /** The command or announcement; null for a restart. */
    text: text('text'),
    /** Seconds before a restart to warn players, longest first. */
    warn: text('warn', { mode: 'json' }).$type<number[]>().notNull().default([]),
    skipWhenEmpty: integer('skip_when_empty', { mode: 'boolean' }).notNull().default(true),
    lastRunAt: integer('last_run_at', { mode: 'timestamp_ms' }),
    lastOk: integer('last_ok', { mode: 'boolean' }),
    /** What happened, like "Restarted in 41s" or "Skipped: the server wasn't running". */
    lastResult: text('last_result'),
    /** A command's reply. */
    lastReply: text('last_reply'),
    createdAt: createdAt(),
  },
  (t) => [index('schedules_server').on(t.server, t.position)],
)
