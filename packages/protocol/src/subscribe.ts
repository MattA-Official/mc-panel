import type { Socket } from 'bun'
import { Frame, type EndReason, type ErrorCode } from './envelope.ts'
import { encode, lineSplitter } from './framing.ts'
import {
  subscriptions,
  type SubEvent,
  type SubParams,
  type SubResult,
  type Subscription,
} from './verbs.ts'

/** How a subscription ended for good. `refused` means the agent never started it. */
export interface SubscriptionEnd {
  reason: EndReason | 'refused'
  message?: string
  /** The agent's error code, when it refused. */
  code?: ErrorCode
}

export interface SubscriptionHandlers<S extends Subscription> {
  /**
   * The agent started the subscription. `again` is true when this follows a reconnect (the
   * agent restarted, for an update say): events may have been missed in between, so callers
   * that keep state should re-seed it.
   */
  onStart?: (result: SubResult<S>, again: boolean) => void
  onEvent: (event: SubEvent<S>) => void
  /** The agent dropped this many events because the panel fell behind. */
  onSkipped?: (count: number) => void
  /** The subscription ended for good. Not called after `close()`. */
  onEnd?: (end: SubscriptionEnd) => void
}

export interface AgentSubscription {
  /** Cancels it. No handler is called after this. */
  close(): void
}

export interface StreamOptions {
  socketPath: string
  /** First wait before reconnecting, doubled after each failure up to `maxBackoffMs`. */
  minBackoffMs?: number
  maxBackoffMs?: number
  /**
   * With live subscriptions the agent sends something at least every 30 s; after this long
   * without a byte the connection is taken as dead and opened again.
   */
  deadAfterMs?: number
}

interface Sub {
  id: string
  verb: Subscription
  params: unknown
  handlers: SubscriptionHandlers<Subscription>
  /** Answered on some connection, so a later answer is a restart. */
  started: boolean
  /** Answered on the current connection. */
  live: boolean
}

const encoder = new TextEncoder()

/**
 * Subscriptions to the agent (protocol 2) over one shared connection. Opens the connection
 * when the first subscription starts and closes it after the last ends. If the connection
 * drops (the agent restarted, for an update), it reconnects with backoff and subscribes again,
 * telling each caller through `onStart(result, true)`.
 *
 * Check `agent.hello` first: an agent that doesn't offer a subscription refuses it.
 */
export class AgentStreams {
  private readonly subs = new Map<string, Sub>()
  private socket: Socket | undefined
  private connecting = false
  private pending = new Uint8Array(0)
  private attempt = 0
  private retry: ReturnType<typeof setTimeout> | undefined
  private watchdog: ReturnType<typeof setInterval> | undefined
  private lastHeard = 0
  private readonly minBackoffMs: number
  private readonly maxBackoffMs: number
  private readonly deadAfterMs: number

  constructor(private readonly opts: StreamOptions) {
    this.minBackoffMs = opts.minBackoffMs ?? 250
    this.maxBackoffMs = opts.maxBackoffMs ?? 10_000
    this.deadAfterMs = opts.deadAfterMs ?? 75_000
  }

  /** Starts a subscription. Params are checked here, so a bad one throws straight away. */
  subscribe<S extends Subscription>(
    verb: S,
    params: SubParams<S>,
    handlers: SubscriptionHandlers<S>,
  ): AgentSubscription {
    const checked = subscriptions[verb].params.parse(params)
    const sub: Sub = {
      id: crypto.randomUUID(),
      verb,
      params: checked,
      handlers: handlers as unknown as SubscriptionHandlers<Subscription>,
      started: false,
      live: false,
    }
    this.subs.set(sub.id, sub)
    if (this.socket) this.send({ id: sub.id, subscribe: verb, params: checked })
    else this.connect()
    return {
      close: () => {
        if (!this.subs.delete(sub.id)) return
        if (this.socket) this.send({ id: sub.id, cancel: true })
        this.idle()
      },
    }
  }

  /** Cancels every subscription and closes the connection. */
  close() {
    this.subs.clear()
    this.idle()
  }

  /** Subscriptions not yet ended or closed. */
  get size() {
    return this.subs.size
  }

  private idle() {
    if (this.subs.size > 0) return
    clearTimeout(this.retry)
    this.retry = undefined
    clearInterval(this.watchdog)
    this.watchdog = undefined
    this.attempt = 0
    const socket = this.socket
    this.socket = undefined
    socket?.end()
  }

  private connect() {
    if (this.socket || this.connecting || this.retry || this.subs.size === 0) return
    this.connecting = true
    const feed = lineSplitter(
      (line) => this.frame(line),
      () => this.socket?.end(),
    )
    const lost = (socket: Socket) => {
      if (this.socket !== socket) return
      this.socket = undefined
      this.pending = new Uint8Array(0)
      for (const sub of this.subs.values()) sub.live = false
      this.later()
    }
    Bun.connect({
      unix: this.opts.socketPath,
      socket: {
        open: (socket) => {
          this.connecting = false
          if (this.subs.size === 0) return void socket.end()
          this.socket = socket
          this.lastHeard = Date.now()
          this.watch()
          for (const sub of this.subs.values())
            this.send({ id: sub.id, subscribe: sub.verb, params: sub.params })
        },
        data: (_socket, chunk) => {
          this.lastHeard = Date.now()
          feed(chunk)
        },
        drain: (socket) => this.flush(socket),
        close: (socket) => lost(socket),
        error: (socket) => lost(socket),
      },
    }).catch(() => {
      this.connecting = false
      this.later()
    })
  }

  /** Tries again after a backoff, if anything still wants the connection. */
  private later() {
    if (this.subs.size === 0 || this.retry) return
    const wait = Math.min(this.maxBackoffMs, this.minBackoffMs * 2 ** this.attempt)
    this.attempt++
    // Some jitter, so a panel and its workers don't all knock at once.
    this.retry = setTimeout(
      () => {
        this.retry = undefined
        this.connect()
      },
      wait * (0.75 + Math.random() / 2),
    )
  }

  /** Drops a connection that has gone quiet for too long, which reconnects. */
  private watch() {
    if (this.watchdog) return
    this.watchdog = setInterval(
      () => {
        if (this.socket && Date.now() - this.lastHeard > this.deadAfterMs) this.socket.end()
      },
      Math.min(10_000, this.deadAfterMs / 2),
    )
  }

  private frame(line: string) {
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      return
    }
    const parsed = Frame.safeParse(raw)
    if (!parsed.success) return
    const f = parsed.data
    if (!('id' in f)) return // a ping; hearing it was the point
    const sub = this.subs.get(f.id)
    if (!sub) return // closed already, or not ours
    const spec = subscriptions[sub.verb]
    if ('ok' in f) {
      if (!f.ok) {
        this.subs.delete(sub.id)
        sub.handlers.onEnd?.({ reason: 'refused', code: f.error.code, message: f.error.message })
        this.idle()
        return
      }
      const result = spec.result.safeParse(f.result)
      const again = sub.started
      sub.started = true
      sub.live = true
      this.attempt = 0
      sub.handlers.onStart?.(result.success ? result.data : {}, again)
    } else if ('event' in f) {
      const event = spec.event.safeParse(f.event)
      if (event.success) sub.handlers.onEvent(event.data as SubEvent<Subscription>)
      else sub.handlers.onSkipped?.(1)
    } else if ('skipped' in f) {
      sub.handlers.onSkipped?.(f.skipped)
    } else if ('end' in f) {
      this.subs.delete(sub.id)
      sub.handlers.onEnd?.({ reason: f.reason, ...(f.message ? { message: f.message } : {}) })
      this.idle()
    }
  }

  private send(message: unknown) {
    const socket = this.socket
    if (!socket) return
    const bytes = encoder.encode(encode(message))
    if (this.pending.length) {
      this.pending = concat(this.pending, bytes)
      return
    }
    const written = socket.write(bytes)
    if (written < bytes.length) this.pending = bytes.slice(Math.max(0, written))
  }

  private flush(socket: Socket) {
    if (!this.pending.length) return
    const written = socket.write(this.pending)
    this.pending = this.pending.slice(Math.max(0, written))
  }
}

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

const shared = new Map<string, AgentStreams>()

/**
 * Subscribes on the shared connection for `socketPath`, so every caller in a process uses one
 * connection to the agent. See `AgentStreams`.
 */
export function subscribeAgent<S extends Subscription>(
  verb: S,
  params: SubParams<S>,
  handlers: SubscriptionHandlers<S>,
  opts: StreamOptions,
): AgentSubscription {
  let streams = shared.get(opts.socketPath)
  if (!streams) {
    streams = new AgentStreams(opts)
    shared.set(opts.socketPath, streams)
  }
  return streams.subscribe(verb, params, handlers)
}
