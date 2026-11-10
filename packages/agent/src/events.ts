/**
 * Following systemd instead of asking it over and over. systemd (PID 1) writes a journal line
 * for every change to a unit: started, main process exited, failed, restart scheduled,
 * stopped. `journalctl --follow` hands those over as they are written, and `service.wait`
 * holds a request open until one concerns a server the panel cares about.
 */
import type { Subprocess } from 'bun'

const UNIT = /^flytower-mc@([a-z][a-z0-9-]{0,30})\.service$/

/** The server a journal line (journalctl -o json) is about, if it's one of ours. */
export function serverOfLine(line: string): string | null {
  let entry: { UNIT?: unknown }
  try {
    entry = JSON.parse(line) as { UNIT?: unknown }
  } catch {
    return null
  }
  return typeof entry.UNIT === 'string' ? (UNIT.exec(entry.UNIT)?.[1] ?? null) : null
}

/** Starts following and calls `onLine` per line; returns a way to stop and a promise of exit. */
export type Follow = (onLine: (line: string) => void) => {
  stop: () => void
  exited: Promise<unknown>
}

/** journalctl, following PID 1's messages from now on. */
export const followJournal: Follow = (onLine) => {
  const proc: Subprocess<'ignore', 'pipe', 'ignore'> = Bun.spawn(
    ['journalctl', '--follow', '--output=json', '--lines=0', '_PID=1'],
    { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' },
  )
  void (async () => {
    const decoder = new TextDecoder()
    let buf = ''
    for await (const chunk of proc.stdout) {
      buf += decoder.decode(chunk, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
      }
      if (buf.length > 1 << 20) buf = ''
    }
  })().catch(() => {})
  return { stop: () => proc.kill(), exited: proc.exited }
}

export interface WaitResult {
  /** Pass back as `after` next time. */
  cursor: string
  /** Servers with news since `after`; all of them when the agent can't tell. */
  changed: string[]
  /** False while the journal can't be followed; the panel should poll instead. */
  following: boolean
}

const KEEP = 1000
/** Changes come in bursts (exited, failed, restart scheduled); answer once for the burst. */
const SETTLE_MS = 300

export class UnitEvents {
  private run = crypto.randomUUID().slice(0, 8)
  private seq = 0
  private log: { seq: number; server: string }[] = []
  private waiters = new Set<() => void>()
  private follower: ReturnType<Follow> | null = null
  private stopped = false
  following = false

  constructor(
    private follow: Follow = followJournal,
    private retryMs = 5000,
  ) {}

  start() {
    if (this.follower || this.stopped) return
    try {
      this.follower = this.follow((line) => {
        const server = serverOfLine(line)
        if (server) this.push(server)
      })
    } catch {
      this.follower = null
    }
    if (!this.follower) return this.retry()
    this.following = true
    void this.follower.exited.then(() => {
      this.follower = null
      this.retry()
    })
  }

  private retry() {
    this.following = false
    // The panel can't know what it missed: everything has changed, as far as it can tell.
    this.run = crypto.randomUUID().slice(0, 8)
    this.wake()
    if (!this.stopped) setTimeout(() => this.start(), this.retryMs)
  }

  stop() {
    this.stopped = true
    this.follower?.stop()
    this.wake()
  }

  push(server: string) {
    this.seq++
    this.log.push({ seq: this.seq, server })
    if (this.log.length > KEEP) this.log.splice(0, this.log.length - KEEP)
    this.wake()
  }

  private wake() {
    for (const w of this.waiters) w()
    this.waiters.clear()
  }

  private since(servers: string[], after: string | null): string[] | null {
    const [run, seqText] = (after ?? '').split(':')
    const seq = Number(seqText)
    // A first call, a restarted agent or a cursor older than what's kept: everything.
    if (run !== this.run || !Number.isInteger(seq) || seq > this.seq) return servers
    if (this.log.length && this.log[0]!.seq > seq + 1) return servers
    // Any of our servers, not only those asked about: one made since the call began counts.
    const changed = new Set(this.log.filter((e) => e.seq > seq).map((e) => e.server))
    return changed.size ? [...changed] : null
  }

  private result(changed: string[]): WaitResult {
    return { cursor: `${this.run}:${this.seq}`, changed, following: this.following }
  }

  /**
   * Answers when any server has changed since `after`, or after `timeoutMs` with none.
   * `servers` is what "everything" means when the agent cannot tell what changed.
   */
  async wait(servers: string[], after: string | null, timeoutMs: number): Promise<WaitResult> {
    if (!this.following) return this.result(servers)
    const now = this.since(servers, after)
    if (now) return this.result(now)
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const left = deadline - Date.now()
      if (left <= 0) return this.result([])
      await new Promise<void>((resolve) => {
        const t = setTimeout(done, left)
        function done() {
          clearTimeout(t)
          resolve()
        }
        this.waiters.add(done)
      })
      if (!this.following) return this.result(servers)
      if (this.since(servers, after)) {
        await Bun.sleep(SETTLE_MS)
        return this.result(this.since(servers, after) ?? [])
      }
    }
  }
}
