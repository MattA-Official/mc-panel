/**
 * One connection to Discord's Gateway, for chat from Discord into the game. It's only opened
 * when "Chat from Discord" is on, and asks for as little as it can: guilds (to know which
 * Discord servers the bot is in) and guild messages, with the message content intent so the
 * text comes through.
 *
 * It keeps itself alive the way Discord asks: heartbeats at the interval Hello gives (the
 * first one after a random part of it), a reconnect when a heartbeat isn't acknowledged,
 * resuming the session where Discord allows it so no messages are missed, and backing off
 * between attempts. Close codes that mean "this will never work" (a bad token, the message
 * content intent switched off) stop it with a reason instead of retrying forever.
 *
 * The Go networking work may take this connection over later; this file is the whole of it.
 */

/** GUILDS, GUILD_MESSAGES and MESSAGE_CONTENT. */
export const INTENTS = (1 << 0) | (1 << 9) | (1 << 15)

export const DEFAULT_GATEWAY = 'wss://gateway.discord.gg'

/** Gateway opcodes. */
const OP = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  Resume: 6,
  Reconnect: 7,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
} as const

/** Closing with this keeps the session resumable (1000 and 1001 end it). */
const RECONNECT_CODE = 4000

/** Close codes after which trying again can't help, with what to tell people. */
export const FATAL_CLOSES: Record<number, string> = {
  4004: 'Discord didn’t accept the bot token. Connect the app again with a new token.',
  4010: 'Discord refused the connection (invalid shard).',
  4011: 'The bot is in too many Discord servers for one connection.',
  4012: 'Discord no longer accepts the Gateway version Flytower uses. Update Flytower.',
  4013: 'Discord refused the intents Flytower asked for. Update Flytower.',
  4014: 'Turn on Message Content Intent for the app: in the Discord Developer Portal, open the app’s Bot tab and switch it on under Privileged Gateway Intents. Then connect again.',
}

/** Close codes after which the session can't be resumed, so the next connection starts afresh. */
const FRESH_CLOSES = new Set([4007, 4009])

/** Waits between attempts (ms), before jitter; the last one repeats. */
export const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000]

export type GatewayState = 'off' | 'connecting' | 'connected' | 'reconnecting' | 'stopped'

export interface GatewayStatus {
  state: GatewayState
  /** Why it's reconnecting or stopped. */
  error: string | null
  /** When the state last changed (ms). */
  since: number | null
  /** The bot's username, once Discord has said who it is. */
  bot: string | null
  /** The Discord servers (guild IDs) the bot is in. */
  guilds: string[]
}

/** The parts of a WebSocket the Gateway uses, so tests can stand in for Discord. */
export interface SocketLike {
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number; reason: string }) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export interface Timers {
  set: (fn: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

export interface GatewayDeps {
  /** The bot token. Throwing stops the connection with the error's message. */
  token: () => Promise<string>
  /** Where to connect, from `GET /gateway/bot`. Falls back to Discord's usual address. */
  gatewayUrl?: (token: string) => Promise<string>
  /** Called for each message created in a channel the bot can see. */
  onMessage: (message: unknown) => void
  onStatus?: (status: GatewayStatus) => void
  connect?: (url: string) => SocketLike
  timers?: Timers
  random?: () => number
  now?: () => number
  log?: (message: string) => void
}

interface Payload {
  op: number
  d: unknown
  s?: number | null
  t?: string | null
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

export class Gateway {
  private socket: SocketLike | null = null
  private running = false
  private status_: GatewayStatus = { state: 'off', error: null, since: null, bot: null, guilds: [] }
  private guilds = new Set<string>()

  private seq: number | null = null
  private sessionId: string | null = null
  private resumeUrl: string | null = null
  private url: string | null = null

  private interval = 0
  private beat: unknown = null
  private acked = true
  private retry: unknown = null
  private attempts = 0
  /** The next close was asked for by us, to reconnect at once. */
  private reconnectNow = false

  private timers: Timers
  private random: () => number
  private now: () => number

  constructor(private deps: GatewayDeps) {
    this.timers = deps.timers ?? defaultTimers
    this.random = deps.random ?? Math.random
    this.now = deps.now ?? Date.now
  }

  status(): GatewayStatus {
    return { ...this.status_, guilds: [...this.guilds] }
  }

  /** Whether the bot is in a Discord server, as far as the Gateway has said. */
  inGuild(id: string): boolean {
    return this.guilds.has(id)
  }

  /** Opens the connection, unless it's already open or opening. */
  start() {
    if (this.running) return
    this.running = true
    this.attempts = 0
    this.seq = null
    this.sessionId = null
    this.resumeUrl = null
    this.setState('connecting', null)
    void this.open()
  }

  /** Closes the connection and forgets the session. */
  stop() {
    this.running = false
    this.clearTimers()
    const s = this.socket
    this.socket = null
    if (s) {
      s.onclose = null
      s.onmessage = null
      try {
        s.close(1000, 'Turned off')
      } catch {
        // Already closed.
      }
    }
    this.seq = null
    this.sessionId = null
    this.resumeUrl = null
    this.guilds.clear()
    this.setState('off', null)
  }

  private setState(state: GatewayState, error: string | null) {
    this.status_ = { ...this.status_, state, error, since: this.now() }
    if (state === 'off' || state === 'stopped') this.status_.bot = null
    this.deps.onStatus?.(this.status())
  }

  private clearTimers() {
    if (this.beat !== null) this.timers.clear(this.beat)
    if (this.retry !== null) this.timers.clear(this.retry)
    this.beat = null
    this.retry = null
  }

  /** Stops for good with a reason; turning it off and on again starts afresh. */
  private fail(message: string) {
    this.running = false
    this.clearTimers()
    const s = this.socket
    this.socket = null
    if (s) {
      s.onclose = null
      try {
        s.close(1000)
      } catch {
        // Already closed.
      }
    }
    this.sessionId = null
    this.seq = null
    this.guilds.clear()
    this.deps.log?.(`[flytower] Discord chat stopped: ${message}`)
    this.setState('stopped', message)
  }

  private async open() {
    let token: string
    try {
      token = await this.deps.token()
    } catch (err) {
      this.fail((err as Error).message)
      return
    }
    if (!this.running) return
    let base = this.sessionId && this.resumeUrl ? this.resumeUrl : this.url
    if (!base) {
      base = (await this.deps.gatewayUrl?.(token).catch(() => null)) ?? DEFAULT_GATEWAY
      this.url = base
    }
    if (!this.running) return
    const url = `${base.replace(/\/+$/, '')}/?v=10&encoding=json`
    let socket: SocketLike
    try {
      socket = (this.deps.connect ?? ((u) => new WebSocket(u) as unknown as SocketLike))(url)
    } catch (err) {
      this.scheduleReconnect(`Couldn’t reach Discord: ${(err as Error).message}`)
      return
    }
    this.socket = socket
    this.acked = true
    socket.onmessage = (ev) => {
      if (this.socket !== socket) return
      let p: Payload
      try {
        p = JSON.parse(String(ev.data)) as Payload
      } catch {
        return
      }
      this.handle(p, token)
    }
    socket.onclose = (ev) => {
      if (this.socket !== socket) return
      this.socket = null
      this.closed(ev.code, ev.reason)
    }
    socket.onerror = () => {
      // A close always follows, and that's where it's handled.
    }
  }

  private send(p: Payload) {
    try {
      this.socket?.send(JSON.stringify(p))
    } catch {
      // The close handler reconnects.
    }
  }

  private handle(p: Payload, token: string) {
    if (typeof p.s === 'number') this.seq = p.s
    switch (p.op) {
      case OP.Hello: {
        const d = p.d as { heartbeat_interval?: number } | null
        this.interval = Math.max(1_000, Number(d?.heartbeat_interval) || 41_250)
        // The first heartbeat comes after a random part of the interval, as Discord asks.
        this.scheduleBeat(Math.floor(this.interval * this.random()))
        if (this.sessionId) {
          this.send({
            op: OP.Resume,
            d: { token, session_id: this.sessionId, seq: this.seq },
          })
        } else {
          this.send({
            op: OP.Identify,
            d: {
              token,
              intents: INTENTS,
              properties: { os: 'linux', browser: 'flytower', device: 'flytower' },
            },
          })
        }
        return
      }
      case OP.HeartbeatAck:
        this.acked = true
        return
      case OP.Heartbeat:
        // Discord asked for one now.
        this.send({ op: OP.Heartbeat, d: this.seq })
        return
      case OP.Reconnect:
        this.reconnect()
        return
      case OP.InvalidSession: {
        if (p.d !== true) {
          this.sessionId = null
          this.seq = null
          this.resumeUrl = null
        }
        // Discord asks for a wait of one to five seconds before identifying again.
        this.reconnectNow = false
        this.dropSocket()
        this.setState('reconnecting', 'Discord asked for a new session.')
        this.retry = this.timers.set(
          () => {
            this.retry = null
            if (this.running) void this.open()
          },
          1_000 + Math.floor(this.random() * 4_000),
        )
        return
      }
      case OP.Dispatch:
        this.dispatch(p.t ?? '', p.d)
        return
    }
  }

  private dispatch(type: string, d: unknown) {
    switch (type) {
      case 'READY': {
        const r = d as {
          session_id?: string
          resume_gateway_url?: string
          user?: { username?: string }
          guilds?: { id: string }[]
        }
        this.sessionId = r.session_id ?? null
        this.resumeUrl = r.resume_gateway_url ?? null
        this.guilds = new Set((r.guilds ?? []).map((g) => g.id))
        this.status_.bot = r.user?.username ?? null
        this.attempts = 0
        this.setState('connected', null)
        return
      }
      case 'RESUMED':
        this.attempts = 0
        this.setState('connected', null)
        return
      case 'GUILD_CREATE': {
        const g = d as { id?: string; unavailable?: boolean }
        if (g.id) this.guilds.add(g.id)
        this.deps.onStatus?.(this.status())
        return
      }
      case 'GUILD_DELETE': {
        // `unavailable` means an outage, not that the bot was removed.
        const g = d as { id?: string; unavailable?: boolean }
        if (g.id && !g.unavailable) this.guilds.delete(g.id)
        this.deps.onStatus?.(this.status())
        return
      }
      case 'MESSAGE_CREATE':
        try {
          this.deps.onMessage(d)
        } catch (err) {
          this.deps.log?.(`[flytower] Discord message failed: ${(err as Error).message}`)
        }
        return
    }
  }

  private scheduleBeat(ms: number) {
    if (this.beat !== null) this.timers.clear(this.beat)
    this.beat = this.timers.set(() => {
      this.beat = null
      if (!this.socket) return
      if (!this.acked) {
        // No answer to the last heartbeat: the connection is dead even if it looks open.
        this.reconnect('Discord stopped answering.')
        return
      }
      this.acked = false
      this.send({ op: OP.Heartbeat, d: this.seq })
      this.scheduleBeat(this.interval)
    }, ms)
  }

  /** Closes this socket in a way that keeps the session, and opens another straight away. */
  private reconnect(why?: string) {
    this.reconnectNow = true
    const s = this.socket
    this.socket = null
    if (s) {
      s.onclose = null
      try {
        s.close(RECONNECT_CODE, 'Reconnecting')
      } catch {
        // Already closed.
      }
    }
    this.closed(RECONNECT_CODE, why ?? '')
  }

  private dropSocket() {
    const s = this.socket
    this.socket = null
    if (this.beat !== null) this.timers.clear(this.beat)
    this.beat = null
    if (s) {
      s.onclose = null
      try {
        s.close(RECONNECT_CODE)
      } catch {
        // Already closed.
      }
    }
  }

  private closed(code: number, reason: string) {
    if (this.beat !== null) this.timers.clear(this.beat)
    this.beat = null
    if (!this.running) return
    const fatal = FATAL_CLOSES[code]
    if (fatal) {
      this.fail(fatal)
      return
    }
    if (FRESH_CLOSES.has(code)) {
      this.sessionId = null
      this.seq = null
      this.resumeUrl = null
    }
    if (this.reconnectNow) {
      this.reconnectNow = false
      this.setState('reconnecting', reason || null)
      void this.open()
      return
    }
    this.scheduleReconnect(
      reason ? `Discord closed the connection: ${reason}` : `Disconnected from Discord (${code}).`,
    )
  }

  private scheduleReconnect(why: string) {
    const base = BACKOFF_MS[Math.min(this.attempts, BACKOFF_MS.length - 1)]!
    this.attempts++
    // Up to a quarter either way, so many panels don't all come back at once.
    const wait = Math.round(base * (0.75 + this.random() * 0.5))
    this.setState('reconnecting', why)
    if (this.retry !== null) this.timers.clear(this.retry)
    this.retry = this.timers.set(() => {
      this.retry = null
      if (this.running) void this.open()
    }, wait)
  }
}
