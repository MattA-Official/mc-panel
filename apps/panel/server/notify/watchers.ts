/**
 * Server events from the server's own log, with no polling: Linux tells us (inotify) the
 * moment `logs/latest.log` changes, and we read only the new lines. Minecraft writes
 * everything worth telling people about there: "Done (…)!" once players can join,
 * "Stopping the server" when it shuts down, and every join and leave.
 *
 * A restart pressed in the panel is announced straight away ("Server restarting"), its
 * shutdown is not reported as a stop, and the next "Done" says "Server restarted".
 */
import { LogStreams, localSource } from '../logs/streams'
import type { EventKind } from '../../shared/notify'
import type { NotifyEvent } from './types'

interface Notify {
  notify(e: NotifyEvent): void
  /** Sends the "back to normal" message for a problem that was reported. */
  resolve?(e: NotifyEvent & { kind: EventKind }): void
}

/** What a log line means for notifications, if anything. */
export type LogEvent =
  { kind: 'ready' } | { kind: 'stopping' } | { kind: 'joined' | 'left'; player: string }

// Vanilla and Fabric: `[12:34:56] [Server thread/INFO]: message`; Paper: `[12:34:56 INFO]: message`.
// The message must start straight after the prefix, so chat like `<Bob> Steve joined the game`
// or `[Server] Stopping the server` (from /say) never matches. Geyser names start with a dot.
// Minecraft 26.x logs joins and leaves as system chat: `[..]: System chat: Steve joined the game`.
// Players can't write that: their chat is logged as `<Bob> …`, so it never starts this way.
const PREFIX = /^\[[^\]]*\](?: \[[^\]]*\])?: (?:System chat: )?(.*)$/
const ACTIVITY = /^([.*]?[A-Za-z0-9_]{1,16}) (joined|left) the game$/
const READY = /^Done \([\d.,]+m?s\)! For help, type "help"/
const STOPPING = /^Stopping (the )?server$/

export function parseLogLine(line: string): LogEvent | null {
  const m = PREFIX.exec(line.trimEnd())
  if (!m) return null
  const msg = m[1]!
  if (READY.test(msg)) return { kind: 'ready' }
  if (STOPPING.test(msg)) return { kind: 'stopping' }
  const a = ACTIVITY.exec(msg)
  return a ? { kind: a[2] === 'joined' ? 'joined' : 'left', player: a[1]! } : null
}

export { SETTLE_MS } from '../console/follow'

/** A restart that hasn't come back within this long is forgotten. */
export const RESTART_WINDOW_MS = 15 * 60_000

/** Follows every server's log (through the shared log streams) and reports what happens in it. */
export class LogWatcher {
  private followed = new Map<string, () => void>()
  private restarting = new Map<string, number>()
  /** Servers that crashed and that systemd is bringing back. */
  private recovering = new Map<string, number>()
  private listeners = new Set<(server: string, e: LogEvent) => void>()
  private lineListeners = new Set<(server: string, line: string) => void>()

  private logs: LogStreams

  constructor(
    private n: Notify,
    serversDir: string,
    private now: () => number = Date.now,
    logs?: LogStreams,
  ) {
    const local = localSource(serversDir)
    this.logs = logs ?? new LogStreams(async () => local, local)
  }

  /** Starts following new servers and stops following deleted ones. */
  sync(servers: string[]) {
    const keep = new Set(servers)
    for (const server of [...this.followed.keys()]) if (!keep.has(server)) this.unfollow(server)
    for (const server of keep) if (!this.followed.has(server)) this.follow(server)
  }

  /** Hears every event in every followed log, for things other than notifications. */
  listen(fn: (server: string, e: LogEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Hears every new log line, before it's read for events (player stats need the UUID line). */
  listenLines(fn: (server: string, line: string) => void): () => void {
    this.lineListeners.add(fn)
    return () => this.lineListeners.delete(fn)
  }

  watching(): string[] {
    return [...this.followed.keys()]
  }

  /**
   * The panel's Restart was pressed: say so now, and expect the server to come back. Flytower's
   * own restart of a server that stopped responding has already said why, so `announce` is off.
   */
  restartPressed(server: string, announce = true) {
    this.restarting.set(server, this.now())
    if (!announce) return
    this.n.notify({
      kind: 'server.restarted',
      server,
      title: 'Server restarting',
      detail: 'It will be back in a minute or so.',
      severity: 'info',
      link: `/servers/${server}`,
    })
  }

  /**
   * Crash detection saw the server crash. When it's ready again, that's "back up" (the crash
   * alert's all-clear) rather than a plain "Server started".
   */
  crashed(server: string) {
    this.restarting.delete(server)
    this.recovering.set(server, this.now())
  }

  /** The restart never happened, so a later stop is a real stop again. */
  restartFailed(server: string) {
    this.restarting.delete(server)
  }

  private isRestarting(server: string) {
    const at = this.restarting.get(server)
    return at !== undefined && this.now() - at < RESTART_WINDOW_MS
  }

  private follow(server: string) {
    // Seed lines were already in the log before we started following (or before the agent
    // reconnected): they aren't news, so only new lines are read for events.
    this.followed.set(
      server,
      this.logs.listen(server, {
        lines: (lines, seed) => {
          if (!seed) this.lines(server, lines)
        },
      }),
    )
  }

  private unfollow(server: string) {
    const stop = this.followed.get(server)
    if (!stop) return
    stop()
    this.followed.delete(server)
    this.restarting.delete(server)
    this.recovering.delete(server)
  }

  lines(server: string, lines: string[]) {
    for (const line of lines) {
      for (const l of this.lineListeners) {
        try {
          l(server, line)
        } catch (err) {
          console.error('[flytower] log line listener failed', err)
        }
      }
      const e = parseLogLine(line)
      if (!e) continue
      for (const l of this.listeners) {
        try {
          l(server, e)
        } catch (err) {
          console.error('[flytower] log listener failed', err)
        }
      }
      const link = `/servers/${server}`
      if (e.kind === 'ready') {
        const crashedAt = this.recovering.get(server)
        this.recovering.delete(server)
        if (crashedAt !== undefined && this.now() - crashedAt < RESTART_WINDOW_MS) {
          this.restarting.delete(server)
          this.n.resolve?.({
            kind: 'server.crashed',
            server,
            title: 'Server is back up',
            detail: 'It started again after crashing. Players can join again.',
            severity: 'ok',
            link,
          })
          continue
        }
        const restarted = this.isRestarting(server)
        this.restarting.delete(server)
        this.n.notify(
          restarted
            ? {
                kind: 'server.restarted',
                server,
                title: 'Server restarted',
                detail: 'Players can join again.',
                severity: 'ok',
                link,
              }
            : {
                kind: 'server.started',
                server,
                title: 'Server started',
                detail: 'Players can join now.',
                severity: 'info',
                link,
              },
        )
      } else if (e.kind === 'stopping') {
        // A restart's shutdown was announced when Restart was pressed.
        if (this.isRestarting(server)) continue
        this.n.notify({
          kind: 'server.stopped',
          server,
          title: 'Server stopping',
          detail: 'It is saving the world and shutting down.',
          severity: 'info',
          link,
        })
      } else {
        this.n.notify({
          kind: e.kind === 'joined' ? 'player.joined' : 'player.left',
          server,
          title: e.kind === 'joined' ? `${e.player} joined` : `${e.player} left`,
          severity: 'info',
          link: `${link}/players`,
        })
      }
    }
  }

  stop() {
    for (const server of [...this.followed.keys()]) this.unfollow(server)
  }
}
