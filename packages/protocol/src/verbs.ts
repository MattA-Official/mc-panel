import { z } from 'zod'
import { ServerName } from './names.ts'

const Port = z.number().int().min(1024).max(65535)

/**
 * Every operation the agent will perform. The agent refuses anything not listed here,
 * so this list is the whole of the panel's root access.
 */
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
  'server.delete': {
    params: z.object({ name: ServerName }).strict(),
    result: z.object({ archivedTo: z.string().nullable() }),
  },
} as const

export type Verb = keyof typeof verbs
export type Params<V extends Verb> = z.infer<(typeof verbs)[V]['params']>
export type Result<V extends Verb> = z.infer<(typeof verbs)[V]['result']>
export const verbNames = Object.keys(verbs) as Verb[]
