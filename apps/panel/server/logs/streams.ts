/**
 * One log stream per server, shared by everything that reads server logs: the console, join
 * and leave notifications (and through them the status page roster and player stats), and
 * crash detection's look at the last lines.
 *
 * With the Rust agent the lines come from `log.follow`: the agent follows the file with
 * inotify and the panel never opens it. With an agent that speaks protocol 1 only (the Bun
 * agent, or one mid-update), the panel follows the file itself as it always has. Both are a
 * `LogSource`, so nothing else knows which is in use.
 */
import { join } from 'node:path'
import { subscribeAgent } from '@flytower/protocol/client'
import { watchServerLog } from '../console/follow'
import { LogTailer } from '../console/tailer'

/** How much of the log a new stream starts with, for the console's scrollback. */
export const SEED_BYTES = 64 * 1024
/** Lines kept per server for a console that opens later and for crash reports. */
export const KEEP_LINES = 500

export interface LogHandlers {
  /**
   * The end of the log as it is now, in whole lines. `fresh` is true for the first batch after
   * starting or reconnecting: what came before should be replaced, not added to.
   */
  seed(lines: string[], fresh: boolean): void
  /** Lines written since. */
  lines(lines: string[]): void
  /** This source can't follow the log (the agent refused, say); try another. */
  failed?(why: string): void
}

export interface LogSource {
  readonly kind: 'agent' | 'local'
  /** Follows `server`'s log until the returned function is called. */
  follow(server: string, seedBytes: number, h: LogHandlers): () => void
}

/** Follows the file itself: inotify through Bun's file watcher, then reading the new bytes. */
export function localSource(serversDir: string): LogSource {
  return {
    kind: 'local',
    follow(server, seedBytes, h) {
      const dir = join(serversDir, server)
      let seeding = true
      const tailer = new LogTailer(
        join(dir, 'logs', 'latest.log'),
        (lines) => (seeding ? h.seed(lines, true) : h.lines(lines)),
        { pollMs: 0, seedBytes },
      )
      let ready = false
      const unwatch = watchServerLog(dir, () => {
        if (ready) void tailer.tick()
      })
      void tailer.start().then(() => {
        seeding = false
        ready = true
        return tailer.tick()
      })
      return () => {
        unwatch()
        tailer.stop()
      }
    },
  }
}

/** Follows through the agent's `log.follow` subscription, over the shared connection. */
export function agentSource(socketPath: string): LogSource {
  return {
    kind: 'agent',
    follow(server, seedBytes, h) {
      let fresh = true
      const sub = subscribeAgent(
        'log.follow',
        { server, seedBytes },
        {
          onStart: () => {
            fresh = true
          },
          onEvent: (e) => {
            if ('seed' in e) {
              h.seed(e.seed, fresh)
              fresh = false
            } else if ('lines' in e) {
              fresh = false
              h.lines(e.lines)
            }
          },
          onEnd: (end) => {
            // A deleted server ends its stream; nothing to fall back to.
            if (end.reason === 'finished') return
            h.failed?.(end.message ?? end.reason)
          },
        },
        { socketPath },
      )
      return () => sub.close()
    },
  }
}

export interface LogListener {
  /** New lines. `seed` lines were already in the log: show them, but they aren't news. */
  lines(lines: string[], seed: boolean): void
  /** The lines kept so far are being replaced by a fresh seed (the agent reconnected). */
  reset?(): void
}

interface Stream {
  buffer: string[]
  listeners: Set<LogListener>
  stop: (() => void) | null
  source: LogSource | null
}

export class LogStreams {
  private streams = new Map<string, Stream>()

  /**
   * `pick` chooses the source for a new stream; `fallback` is used when that source fails
   * (and from then on, when `pick` agrees).
   */
  constructor(
    private pick: () => Promise<LogSource>,
    private fallback: LogSource,
    private onFallback: () => void = () => {},
  ) {}

  /** Hears `server`'s log until the returned function is called. */
  listen(server: string, listener: LogListener): () => void {
    let s = this.streams.get(server)
    if (!s) {
      s = { buffer: [], listeners: new Set(), stop: null, source: null }
      this.streams.set(server, s)
      const stream = s
      void this.pick().then(
        (source) => this.start(server, stream, source),
        () => this.start(server, stream, this.fallback),
      )
    }
    s.listeners.add(listener)
    const stream = s
    return () => {
      stream.listeners.delete(listener)
      if (stream.listeners.size) return
      stream.stop?.()
      stream.stop = null
      if (this.streams.get(server) === stream) this.streams.delete(server)
    }
  }

  /** The last lines of `server`'s log, if anything follows it. */
  recent(server: string): string[] {
    return [...(this.streams.get(server)?.buffer ?? [])]
  }

  /** Which source each followed server uses, for the System page and tests. */
  sources(): Record<string, LogSource['kind'] | null> {
    return Object.fromEntries([...this.streams].map(([n, s]) => [n, s.source?.kind ?? null]))
  }

  private start(server: string, s: Stream, source: LogSource) {
    // Everyone stopped listening while the source was being chosen.
    if (this.streams.get(server) !== s) return
    s.source = source
    s.stop = source.follow(server, SEED_BYTES, {
      seed: (lines, fresh) => {
        if (fresh) {
          s.buffer = []
          for (const l of s.listeners) l.reset?.()
        }
        this.add(s, lines, true)
      },
      lines: (lines) => this.add(s, lines, false),
      failed: (why) => {
        if (source === this.fallback || this.streams.get(server) !== s) return
        console.error(`[flytower] following ${server}'s log through the agent failed: ${why}`)
        s.stop?.()
        this.onFallback()
        this.start(server, s, this.fallback)
      },
    })
  }

  private add(s: Stream, lines: string[], seed: boolean) {
    if (!lines.length) return
    s.buffer.push(...lines)
    if (s.buffer.length > KEEP_LINES) s.buffer.splice(0, s.buffer.length - KEEP_LINES)
    for (const l of s.listeners) {
      try {
        l.lines(lines, seed)
      } catch (err) {
        console.error('[flytower] log listener failed', err)
      }
    }
  }
}
