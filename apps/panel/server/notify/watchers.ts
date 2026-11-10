/**
 * Server events from the server's own log, with no polling: Linux tells us (inotify) the
 * moment `logs/latest.log` changes, and we read only the new lines. Minecraft writes
 * everything worth telling people about there: "Done (…)!" once players can join,
 * "Stopping the server" when it shuts down, and every join and leave.
 *
 * A restart pressed in the panel is announced straight away ("Server restarting"), its
 * shutdown is not reported as a stop, and the next "Done" says "Server restarted".
 */
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { LogTailer } from '../console/tailer'
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
const PREFIX = /^\[[^\]]*\](?: \[[^\]]*\])?: (.*)$/
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

/** A restart that hasn't come back within this long is forgotten. */
export const RESTART_WINDOW_MS = 15 * 60_000

interface Followed {
  tailer: LogTailer
  watchers: FSWatcher[]
  logsWatched: boolean
  ready: boolean
}

/** Follows every server's log through inotify and reports what happens in it. */
export class LogWatcher {
  private followed = new Map<string, Followed>()
  private restarting = new Map<string, number>()
  /** Servers that crashed and that systemd is bringing back. */
  private recovering = new Map<string, number>()

  constructor(
    private n: Notify,
    private serversDir: string,
    private now: () => number = Date.now,
  ) {}

  /** Starts following new servers and stops following deleted ones. */
  sync(servers: string[]) {
    const keep = new Set(servers)
    for (const server of [...this.followed.keys()]) if (!keep.has(server)) this.unfollow(server)
    for (const server of keep) if (!this.followed.has(server)) this.follow(server)
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
    const dir = join(this.serversDir, server)
    const logs = join(dir, 'logs')
    const f: Followed = {
      tailer: new LogTailer(join(logs, 'latest.log'), (lines) => this.lines(server, lines), {
        pollMs: 0,
        seedBytes: 0,
      }),
      watchers: [],
      logsWatched: false,
      ready: false,
    }
    this.followed.set(server, f)
    const changed = () => {
      if (f.ready) void f.tailer.tick()
    }
    const watchLogs = () => {
      if (f.logsWatched) return
      try {
        f.watchers.push(
          watch(logs, (_event, file) => {
            if (!file || file === 'latest.log') changed()
          }),
        )
        f.logsWatched = true
      } catch {
        // No logs folder yet: the server has never run. The folder watch below sees it appear.
      }
    }
    try {
      // The server's own folder, for a logs folder that doesn't exist yet.
      f.watchers.push(
        watch(dir, (_event, file) => {
          if (file === 'logs') {
            watchLogs()
            changed()
          }
        }),
      )
    } catch (err) {
      console.error(`[flytower] notifications can't watch ${server}'s folder`, err)
    }
    watchLogs()
    // Start at the end of the log: what happened before the panel started isn't news.
    void f.tailer.start().then(() => {
      f.ready = true
      return f.tailer.tick()
    })
  }

  private unfollow(server: string) {
    const f = this.followed.get(server)
    if (!f) return
    for (const w of f.watchers) w.close()
    f.tailer.stop()
    this.followed.delete(server)
    this.restarting.delete(server)
    this.recovering.delete(server)
  }

  lines(server: string, lines: string[]) {
    for (const line of lines) {
      const e = parseLogLine(line)
      if (!e) continue
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
