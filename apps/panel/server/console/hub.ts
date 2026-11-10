import { join } from 'node:path'
import { Rcon, RconError, stripFormatting } from '@flytower/rcon'
import { LogTailer } from './tailer'

export type ConsoleMessage =
  { type: 'snapshot'; lines: string[] } | { type: 'lines'; lines: string[] }

export interface RconTarget {
  port: number
  password: string
}

export interface HubDeps {
  serversDir: string
  /** Looks up a server's RCON details; null if the server doesn't exist. */
  rconTarget: (name: string) => RconTarget | null
  connect?: (target: RconTarget) => Promise<Pick<Rcon, 'command' | 'close' | 'isOpen'>>
  pollMs?: number
}

const BUFFER_LINES = 500

interface Stream {
  tailer: LogTailer
  buffer: string[]
  listeners: Set<(m: ConsoleMessage) => void>
}

/**
 * One log tailer per watched server, fanned out to every open console, plus a cached RCON
 * connection per server for commands. Tailers stop when the last console closes.
 */
export class ConsoleHub {
  private streams = new Map<string, Stream>()
  private rcons = new Map<string, Promise<Pick<Rcon, 'command' | 'close' | 'isOpen'>>>()

  constructor(private deps: HubDeps) {}

  watch(name: string, listener: (m: ConsoleMessage) => void): () => void {
    let stream = this.streams.get(name)
    if (!stream) {
      stream = {
        buffer: [],
        listeners: new Set(),
        tailer: new LogTailer(
          join(this.deps.serversDir, name, 'logs', 'latest.log'),
          (lines) => this.push(name, lines),
          { pollMs: this.deps.pollMs },
        ),
      }
      this.streams.set(name, stream)
      // The tail's seed lines follow as ordinary `lines` messages.
      void stream.tailer.start()
    }
    listener({ type: 'snapshot', lines: [...stream.buffer] })
    stream.listeners.add(listener)
    const s = stream
    return () => {
      s.listeners.delete(listener)
      if (s.listeners.size === 0) {
        s.tailer.stop()
        this.streams.delete(name)
      }
    }
  }

  /**
   * Runs a command and echoes it, with the reply, to every console on that server. Background
   * reads (the Players tab polling `list`) pass `echo: false` so the console stays readable.
   */
  async command(
    name: string,
    command: string,
    opts: {
      echo?: boolean
      timeoutMs?: number
      /** Echo this instead: the command as typed and what to show for the reply. */
      echoAs?: { command: string; reply: (reply: string) => string[] }
    } = {},
  ): Promise<string> {
    const target = this.deps.rconTarget(name)
    if (!target) throw new RconError(`No server called ${name}.`)
    const rcon = await this.rcon(name, target)
    let reply: string
    try {
      reply = stripFormatting(await rcon.command(command, { timeoutMs: opts.timeoutMs }))
    } catch (err) {
      this.rcons.delete(name)
      rcon.close()
      throw err
    }
    if (opts.echo !== false) {
      this.push(
        name,
        opts.echoAs
          ? [`> ${opts.echoAs.command}`, ...opts.echoAs.reply(reply)]
          : [`> ${command}`, ...(reply ? reply.split('\n') : [])],
      )
    }
    return reply
  }

  /** Drops a server's RCON connection, e.g. after it stops. */
  forget(name: string) {
    void this.rcons.get(name)?.then(
      (r) => r.close(),
      () => {},
    )
    this.rcons.delete(name)
  }

  private async rcon(name: string, target: RconTarget) {
    const cached = this.rcons.get(name)
    if (cached) {
      const r = await cached.catch(() => null)
      if (r?.isOpen) return r
    }
    const connect =
      this.deps.connect ??
      ((t: RconTarget) => Rcon.connect({ host: '127.0.0.1', port: t.port, password: t.password }))
    const fresh = connect(target)
    this.rcons.set(name, fresh)
    fresh.catch(() => this.rcons.delete(name))
    return fresh
  }

  private push(name: string, raw: string[]) {
    const stream = this.streams.get(name)
    if (!stream) return
    const lines = raw.map(stripFormatting)
    stream.buffer.push(...lines)
    if (stream.buffer.length > BUFFER_LINES)
      stream.buffer.splice(0, stream.buffer.length - BUFFER_LINES)
    for (const l of stream.listeners) l({ type: 'lines', lines })
  }
}
