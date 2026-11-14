import { z } from 'zod'

/** What `ping` reports. Stays 1; `agent.hello` lists every version an agent speaks. */
export const PROTOCOL_VERSION = 1

/** Protocol 2 adds subscriptions: see `Subscribe` and `Frame` below. */
export const SUBSCRIPTIONS_PROTOCOL = 2

/** Longest single message the agent will read, in bytes. Requests are tiny; this bounds memory. */
export const MAX_LINE_BYTES = 64 * 1024

/**
 * Longest single line the agent sends. Most are small, but a batch of log lines can be large,
 * so the panel accepts more than the agent does.
 */
export const MAX_FRAME_BYTES = 1024 * 1024

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

/**
 * Opens a subscription (protocol 2). The agent answers like a request (`Response`), then
 * sends frames for this `id` until an `EndFrame`. Several can share one connection.
 */
export const Subscribe = z
  .object({
    id: z.string().min(1).max(64),
    subscribe: z.string().min(1).max(64),
    params: z.unknown(),
  })
  .strict()
export type Subscribe = z.infer<typeof Subscribe>

/** Stops a subscription. The agent still sends its `EndFrame`, with reason `cancelled`. */
export const Cancel = z.object({ id: z.string().min(1).max(64), cancel: z.literal(true) }).strict()
export type Cancel = z.infer<typeof Cancel>

/** One event of a subscription; its schema is the verb's `event` in `subscriptions`. */
export const EventFrame = z.object({ id: z.string(), event: z.unknown() }).strict()

/** The panel fell behind and the agent dropped this many events rather than queue them. */
export const SkippedFrame = z.object({ id: z.string(), skipped: z.number().int().min(1) }).strict()

export const EndReason = z.enum([
  'finished', // nothing more to send, such as a followed server being deleted
  'cancelled', // the panel cancelled it
  'failed', // it broke; message says how
])
export type EndReason = z.infer<typeof EndReason>

/** The last frame of a subscription. */
export const EndFrame = z
  .object({
    id: z.string(),
    end: z.literal(true),
    reason: EndReason,
    message: z.string().optional(),
  })
  .strict()

/**
 * Sent every 30 s on a connection with live subscriptions when nothing else was, so the
 * panel can tell a quiet agent from a dead one.
 */
export const PingFrame = z.object({ ping: z.literal(true) }).strict()

/** Anything the agent sends: a response, or a subscription's frames. */
export const Frame = z.union([Response, EventFrame, SkippedFrame, EndFrame, PingFrame])
export type Frame = z.infer<typeof Frame>

export class AgentError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AgentError'
  }
}
