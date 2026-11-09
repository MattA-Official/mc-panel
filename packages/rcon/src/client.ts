import type { Socket } from 'bun'
import { encodePacket, PacketParser, PacketType, type Packet } from './packet.ts'

export class RconError extends Error {
  override name = 'RconError'
}

export interface RconOptions {
  host: string
  port: number
  password: string
  /** Per request, including login. */
  timeoutMs?: number
}

/** Minecraft rejects longer commands. */
export const MAX_COMMAND_BYTES = 1446

interface InFlight {
  /** The id answers carry: the command's, or the login's. */
  id: number
  /** For commands: the id of the empty packet sent after it, whose echo ends the reply. */
  sentinel: number | null
  parts: string[]
  resolve: (body: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * One RCON connection. Commands are queued, so callers can fire several at once without
 * their replies interleaving. Any protocol error or timeout closes the connection; make a
 * new one to carry on.
 */
export class Rcon {
  private parser = new PacketParser()
  private nextId = 1
  private current: InFlight | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  private timeoutMs: number
  private socket!: Socket<undefined>

  private constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs
  }

  static async connect(opts: RconOptions): Promise<Rcon> {
    const rcon = new Rcon(opts.timeoutMs ?? 5000)
    try {
      rcon.socket = await Bun.connect({
        hostname: opts.host,
        port: opts.port,
        socket: {
          data: (_s, chunk) => rcon.onData(chunk),
          close: () => rcon.fail(new RconError('The server closed the RCON connection.')),
          error: (_s, err) => rcon.fail(new RconError(`RCON connection error: ${err.message}`)),
        },
      })
    } catch {
      throw new RconError(`Couldn't connect to RCON on port ${opts.port}. Is the server running?`)
    }
    await rcon.request(PacketType.Auth, opts.password, false).catch((err) => {
      rcon.close()
      throw err
    })
    return rcon
  }

  get isOpen() {
    return !this.closed
  }

  /** Runs a console command (without the leading slash) and returns the full reply. */
  /** Runs a command. `timeoutMs` overrides the connection's default for slow ones. */
  command(command: string, opts: { timeoutMs?: number } = {}): Promise<string> {
    if (new TextEncoder().encode(command).length > MAX_COMMAND_BYTES) {
      return Promise.reject(new RconError('That command is too long for RCON.'))
    }
    return this.request(PacketType.Command, command, true, opts.timeoutMs)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.socket?.end()
    this.fail(new RconError('RCON connection closed.'))
  }

  private request(
    type: number,
    body: string,
    withSentinel: boolean,
    timeoutMs = this.timeoutMs,
  ): Promise<string> {
    const run = () =>
      new Promise<string>((resolve, reject) => {
        if (this.closed) return reject(new RconError('RCON connection closed.'))
        const id = this.id()
        const sentinel = withSentinel ? this.id() : null
        const timer = setTimeout(() => {
          this.fail(new RconError('The server took too long to answer.'))
          this.close()
        }, timeoutMs)
        this.current = { id, sentinel, parts: [], resolve, reject, timer }
        this.socket.write(encodePacket(id, type, body))
        if (sentinel !== null) this.socket.write(encodePacket(sentinel, PacketType.Response, ''))
      })
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => {})
    return result
  }

  private id() {
    const id = this.nextId
    this.nextId = this.nextId >= 0x7fffffff ? 1 : this.nextId + 1
    return id
  }

  private onData(chunk: Uint8Array) {
    let packets: Packet[]
    try {
      packets = this.parser.push(chunk)
    } catch (err) {
      this.fail(new RconError((err as Error).message))
      this.close()
      return
    }
    for (const p of packets) this.onPacket(p)
  }

  private onPacket(p: Packet) {
    const c = this.current
    if (!c) return
    if (c.sentinel === null) {
      // Logging in: the answer is a type-2 packet carrying our id, or -1 for a bad password.
      if (p.type !== PacketType.Command) return
      if (p.id === -1) {
        this.fail(new RconError('The RCON password was refused.'))
        return
      }
      if (p.id === c.id) this.finish('')
      return
    }
    if (p.id === c.id) c.parts.push(p.body)
    else if (p.id === c.sentinel) this.finish(c.parts.join(''))
  }

  private finish(body: string) {
    const c = this.current
    if (!c) return
    clearTimeout(c.timer)
    this.current = null
    c.resolve(body)
  }

  private fail(err: Error) {
    const c = this.current
    if (!c) {
      this.closed = true
      return
    }
    clearTimeout(c.timer)
    this.current = null
    c.reject(err)
  }
}
