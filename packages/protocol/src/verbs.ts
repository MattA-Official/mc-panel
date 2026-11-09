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
      })
      .strict()
      .refine((p) => p.memoryMb !== undefined || p.port !== undefined, 'nothing to change'),
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
  'server.delete': {
    params: z.object({ name: ServerName }).strict(),
    result: z.object({ archivedTo: z.string().nullable() }),
  },
} as const

export type Verb = keyof typeof verbs
export type Params<V extends Verb> = z.infer<(typeof verbs)[V]['params']>
export type Result<V extends Verb> = z.infer<(typeof verbs)[V]['result']>
export const verbNames = Object.keys(verbs) as Verb[]
