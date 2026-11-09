/**
 * The background watchers that turn what the panel already sees into notifications: servers
 * starting and stopping (from the metrics sampler), players joining and leaving (from each
 * server's log), the disk filling up, and new versions of Flytower and of installed content.
 */
import { join } from 'node:path'
import { LogTailer } from '../console/tailer'
import type { EventKind } from '../../shared/notify'
import type { NotifyEvent } from './types'

interface Notify {
  notify(e: NotifyEvent): void
  wants(kind: EventKind): boolean
}

/** Spots servers starting and stopping between samples. The first sample only sets the scene. */
export class RunningTracker {
  private last = new Map<string, boolean>()

  constructor(private n: Pick<Notify, 'notify'>) {}

  update(active: Record<string, boolean>) {
    for (const [server, running] of Object.entries(active)) {
      const was = this.last.get(server)
      this.last.set(server, running)
      if (was === undefined || was === running) continue
      this.n.notify(
        running
          ? {
              kind: 'server.started',
              server,
              title: 'Server started',
              severity: 'info',
              link: `/servers/${server}`,
            }
          : {
              kind: 'server.stopped',
              server,
              title: 'Server stopped',
              severity: 'info',
              link: `/servers/${server}`,
            },
      )
    }
  }

  forget(server: string) {
    this.last.delete(server)
  }
}

// Vanilla and Fabric: `[12:34:56] [Server thread/INFO]: Steve joined the game`
// Paper: `[12:34:56 INFO]: Steve joined the game`. A name must come straight after the
// prefix, so chat like `<Bob> Steve joined the game` doesn't match. Geyser names start with a dot.
const ACTIVITY = /^\[[^\]]*\](?: \[[^\]]*\])?: ([.*]?[A-Za-z0-9_]{1,16}) (joined|left) the game$/

export function parseActivity(line: string): { player: string; joined: boolean } | null {
  const m = ACTIVITY.exec(line.trimEnd())
  return m ? { player: m[1]!, joined: m[2] === 'joined' } : null
}

/**
 * Follows every server's log while a channel wants joins or leaves, and stops when none do.
 * Only lines written after it starts count, so a panel restart doesn't replay old joins.
 */
export class PlayerWatcher {
  private tailers = new Map<string, LogTailer>()

  constructor(
    private n: Notify,
    private serversDir: string,
    private pollMs = 2000,
  ) {}

  /** Starts or stops tailers to match the servers and what channels want. */
  sync(servers: string[]) {
    const wanted = this.n.wants('player.joined') || this.n.wants('player.left')
    const keep = new Set(wanted ? servers : [])
    for (const [server, t] of this.tailers) {
      if (!keep.has(server)) {
        t.stop()
        this.tailers.delete(server)
      }
    }
    for (const server of keep) {
      if (this.tailers.has(server)) continue
      const t = new LogTailer(
        join(this.serversDir, server, 'logs', 'latest.log'),
        (lines) => this.lines(server, lines),
        { pollMs: this.pollMs, seedBytes: 0 },
      )
      this.tailers.set(server, t)
      void t.start()
    }
  }

  /** The servers being followed. */
  watching(): string[] {
    return [...this.tailers.keys()]
  }

  lines(server: string, lines: string[]) {
    for (const line of lines) {
      const a = parseActivity(line)
      if (!a) continue
      this.n.notify({
        kind: a.joined ? 'player.joined' : 'player.left',
        server,
        title: a.joined ? `${a.player} joined` : `${a.player} left`,
        severity: 'info',
        link: `/servers/${server}/players`,
      })
    }
  }

  stop() {
    for (const t of this.tailers.values()) t.stop()
    this.tailers.clear()
  }
}
