import { z } from 'zod'

export const PROTOCOL_VERSION = 1

/** Longest single message the agent will read, in bytes. Requests are tiny; this bounds memory. */
export const MAX_LINE_BYTES = 64 * 1024

export const ErrorCode = z.enum([
  'bad_request', // not valid JSON or not a valid envelope
  'unknown_verb',
  'invalid_params',
  'forbidden', // caller is not the panel user
  'conflict', // e.g. server already exists
  'not_found',
  'failed', // the operation ran and failed
  'internal',
])
export type ErrorCode = z.infer<typeof ErrorCode>

export const Request = z
  .object({
    id: z.string().min(1).max(64),
    verb: z.string().min(1).max(64),
    params: z.unknown(),
  })
  .strict()
export type Request = z.infer<typeof Request>

export const Response = z.discriminatedUnion('ok', [
  z.object({ id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({
    id: z.string(),
    ok: z.literal(false),
    error: z.object({ code: ErrorCode, message: z.string() }),
  }),
])
export type Response = z.infer<typeof Response>

export class AgentError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AgentError'
  }
}
