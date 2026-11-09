import { z } from 'zod'
import { ServerName } from './names.ts'

const Port = z.number().int().min(1024).max(65535)

/**
 * Every operation the agent will perform. The agent refuses anything not listed here,
 * so this list is the whole of the panel's root access.
 */
const SshState = z.object({
  /** True if any firewall rule lets SSH in. */
  open: z.boolean(),
  ports: z.array(z.number().int()),
  /** When a temporary opening ends, as an ISO time. */
  closesAt: z.string().nullable(),
  /** False if ufw is inactive, in which case nothing can be closed. */
  firewall: z.boolean(),
})

const Version = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/, 'not a release version')

export const UpdateRecord = z.object({
  state: z.enum(['running', 'succeeded', 'rolled-back', 'failed']),
  from: z.string(),
  to: z.string(),
  /** Why it rolled back or failed. */
  reason: z.string().nullable(),
  at: z.string(),
  manual: z.boolean(),
})

export const verbs = {
  ping: {
    params: z.object({}).strict(),
    result: z.object({ agentVersion: z.string(), protocol: z.number().int() }),
  },
  'service.status': {
    params: z.object({ server: ServerName }).strict(),
    result: z.object({
      active: z.enum(['active', 'inactive', 'activating', 'deactivating', 'failed', 'unknown']),
      since: z.string().nullable(),
      /**
       * How the last run ended, as systemd's `Result`: `success`, `exit-code`, `signal`,
       * `core-dump`, `oom-kill`, `timeout`, `watchdog` or `start-limit-hit`. Optional because
       * agents before 1.1 don't send it, nor the fields below.
       */
      result: z.string().nullable().optional(),
      /** Automatic restarts since the last explicit start (`NRestarts`). */
      restarts: z.number().int().nullable().optional(),
      /** How the main process last ended: by exiting, by a signal, or by a signal with a core dump. */
      exitKind: z.enum(['exited', 'killed', 'dumped']).nullable().optional(),
      /** The exit code, or the signal number when it was killed. */
      exitStatus: z.number().int().nullable().optional(),
    }),
  },
  /** CPU time and memory systemd has counted for each server, for the metrics history. */
  'service.usage': {
    params: z.object({ servers: z.array(ServerName).max(100) }).strict(),
    result: z.object({
      usage: z.record(
        z.string(),
        z.object({
          active: z.boolean(),
          /** Total CPU time used since the server started, in nanoseconds. */
          cpuNs: z.number().nullable(),
          memoryBytes: z.number().nullable(),
        }),
      ),
    }),
  },
  'service.start': { params: z.object({ server: ServerName }).strict(), result: z.object({}) },
  'service.stop': { params: z.object({ server: ServerName }).strict(), result: z.object({}) },
  'service.restart': { params: z.object({ server: ServerName }).strict(), result: z.object({}) },
  'runtime.install': {
    params: z
      .object({ vendor: z.literal('temurin'), major: z.number().int().min(8).max(99) })
      .strict(),
    result: z.object({ javaHome: z.string(), version: z.string(), alreadyInstalled: z.boolean() }),
  },
  'server.create': {
    params: z
      .object({
        name: ServerName,
        port: Port,
        memoryMb: z.number().int().min(512).max(262144),
        javaMajor: z.number().int().min(8).max(99),
      })
      .strict(),
    result: z.object({ directory: z.string(), user: z.string(), unit: z.string() }),
  },
  'server.configure': {
    params: z
      .object({
        name: ServerName,
        memoryMb: z.number().int().min(512).max(262144).optional(),
        port: Port.optional(),
        /** Switches the server to another installed Java (runtime.install first). */
        javaMajor: z.number().int().min(8).max(99).optional(),
      })
      .strict()
      .refine(
        (p) => p.memoryMb !== undefined || p.port !== undefined || p.javaMajor !== undefined,
        'nothing to change',
      ),
    result: z.object({}),
  },
  /**
   * Gives the panel's group read and write on everything in a server folder. Minecraft
   * writes some files (level.dat) through 0600 temporary files, which the panel then can't
   * back up or edit.
   */
  'server.permissions': {
    params: z.object({ name: ServerName }).strict(),
    result: z.object({}),
  },
  'ssh.status': { params: z.object({}).strict(), result: SshState },
  /**
   * Opens or closes SSH in the firewall. `minutes` opens it for that long; the agent closes
   * it again itself, even across restarts.
   */
  'ssh.set': {
    params: z
      .object({ open: z.boolean(), minutes: z.number().int().min(1).max(1440).optional() })
      .strict()
      .refine((p) => p.open || p.minutes === undefined, 'minutes only applies when opening'),
    result: SshState,
  },
  /** Installed Flytower releases and the last update. */
  'update.status': {
    params: z.object({}).strict(),
    result: z.object({
      current: z.string(),
      releases: z.array(z.string()),
      last: UpdateRecord.nullable(),
    }),
  },
  /**
   * Downloads a release from Flytower's own GitHub releases (never another address), checks
   * its signature and hash, and hands over to the updater, which restarts the panel and
   * agent and rolls back by itself if the new version isn't healthy.
   */
  'update.install': {
    params: z.object({ version: Version }).strict(),
    result: z.object({ started: z.literal(true) }),
  },
  /** Switches back to another release already installed, through the same updater. */
  'update.rollback': {
    params: z.object({ version: Version }).strict(),
    result: z.object({ started: z.literal(true) }),
  },
  'server.delete': {
    params: z.object({ name: ServerName }).strict(),
    result: z.object({ archivedTo: z.string().nullable() }),
  },
} as const

export type Verb = keyof typeof verbs
export type Params<V extends Verb> = z.infer<(typeof verbs)[V]['params']>
export type Result<V extends Verb> = z.infer<(typeof verbs)[V]['result']>
export const verbNames = Object.keys(verbs) as Verb[]
