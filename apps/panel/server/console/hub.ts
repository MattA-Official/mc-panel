import { Rcon, RconError, stripFormatting } from '@flytower/rcon'
import { LogStreams, localSource } from '../logs/streams'

export type ConsoleMessage =
  { type: 'snapshot'; lines: string[] } | { type: 'lines'; lines: string[] }

export interface RconTarget {
  port: number
  password: string
}

export interface HubDeps {
  serversDir: string
  /** The shared log streams; by default the hub follows the files itself. */
  logs?: LogStreams
  /** Looks up a server's RCON details; null if the server doesn't exist. */
  rconTarget: (name: string) => RconTarget | null
  connect?: (target: RconTarget) => Promise<RconClient>
}

type RconClient = Pick<Rcon, 'command' | 'close' | 'isOpen'>

const BUFFER_LINES = 500

interface Stream {
  unlisten: () => void
  buffer: string[]
  listeners: Set<(m: ConsoleMessage) => void>
  /** The log stream is starting again; its seed replaces the buffer. */
  resetting: boolean
}

/**
 * The server's log stream, fanned out to every open console, plus a cached RCON connection
 * per server for commands. The log comes from the shared `LogStreams` (the agent's
 * `log.follow`, or inotify on the file), so an open console doesn't poll.
 */
export class ConsoleHub {
  private streams = new Map<string, Stream>()
  private rcons = new Map<string, Promise<RconClient>>()
  private logs: LogStreams

  constructor(private deps: HubDeps) {
    const local = localSource(deps.serversDir)
    this.logs = deps.logs ?? new LogStreams(async () => local, local)
  }

  watch(name: string, listener: (m: ConsoleMessage) => void): () => void {
    let stream = this.streams.get(name)
    if (!stream) {
      // Something else (notifications) may already follow this log: start from what it has.
      const s: Stream = {
        buffer: this.logs.recent(name).map(stripFormatting).slice(-BUFFER_LINES),
        listeners: new Set(),
        unlisten: () => {},
        resetting: false,
      }
      this.streams.set(name, s)
      s.unlisten = this.logs.listen(name, {
        reset: () => (s.resetting = true),
        lines: (lines, seed) => {
          if (seed && s.resetting) {
            // After the agent reconnects: show the fresh seed in place of what was there, so
            // no line appears twice.
            s.resetting = false
            s.buffer = lines.map(stripFormatting).slice(-BUFFER_LINES)
            for (const l of s.listeners) l({ type: 'snapshot', lines: [...s.buffer] })
            return
          }
          this.push(name, lines)
        },
      })
      stream = s
    }
    listener({ type: 'snapshot', lines: [...stream.buffer] })
    stream.listeners.add(listener)
    const s = stream
    return () => {
      s.listeners.delete(listener)
      if (s.listeners.size === 0) {
        s.unlisten()
        if (this.streams.get(name) === s) this.streams.delete(name)
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
    const { client: rcon, entry } = await this.rcon(name, target)
    let reply: string
    try {
      reply = stripFormatting(await rcon.command(command, { timeoutMs: opts.timeoutMs }))
    } catch (err) {
      // Only drop the connection this command used: another caller may have replaced it.
      if (this.rcons.get(name) === entry) this.rcons.delete(name)
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

  /** Adds lines to a server's console that aren't in its log, like chat from Discord. */
  show(name: string, lines: string[]) {
    this.push(name, lines)
  }

  /** Drops a server's RCON connection, e.g. after it stops. */
  forget(name: string) {
    void this.rcons.get(name)?.then(
      (r) => r.close(),
      () => {},
    )
    this.rcons.delete(name)
  }

  /**
   * The server's RCON connection, opening one if there's none or it has closed. The pending
   * connection is what's cached, so callers that arrive together share one connection
   * instead of each opening their own and leaving all but the last unclosed.
   */
  private async rcon(
    name: string,
    target: RconTarget,
  ): Promise<{ client: RconClient; entry: Promise<RconClient> }> {
    for (;;) {
      const cached = this.rcons.get(name)
      if (!cached) break
      const r = await cached.catch(() => null)
      if (r?.isOpen) return { client: r, entry: cached }
      // Closed or failed. If someone else has already replaced it, use theirs.
      if (this.rcons.get(name) !== cached) continue
      this.rcons.delete(name)
      break
    }
    const connect =
      this.deps.connect ??
      ((t: RconTarget) => Rcon.connect({ host: '127.0.0.1', port: t.port, password: t.password }))
    const fresh = connect(target)
    this.rcons.set(name, fresh)
    fresh.catch(() => {
      if (this.rcons.get(name) === fresh) this.rcons.delete(name)
    })
    return { client: await fresh, entry: fresh }
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
