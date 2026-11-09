import type { Result } from '@flytower/protocol'
import type { AgentCall } from './runner'

export type ServiceStatus = Result<'service.status'>
export type ServiceState = ServiceStatus['active']
export type StatusMap = Record<string, ServiceState>
type Listener = (statuses: StatusMap) => void
/** Every poll's full answers; null where the agent didn't answer. */
type PollHook = (statuses: Record<string, ServiceStatus | null>) => void | Promise<void>

/**
 * Keeps an eye on every server's systemd state. With `follow`, it waits on the agent, which
 * answers when systemd's journal shows a server changing (and every five minutes regardless,
 * as a safety net), so nothing is polled. If the agent can't follow the journal, it falls
 * back to asking every ten seconds. Without `follow` (in tests), it polls every few seconds
 * while someone is watching. Listeners get the full map on subscribe and on any change.
 */
export class StatusWatcher {
  private listeners = new Set<Listener>()
  private timer: ReturnType<typeof setInterval> | null = null
  private last: StatusMap = {}
  private polling: Promise<void> | null = null
  private following = false

  constructor(
    private agent: AgentCall,
    private names: () => string[],
    private intervalMs = 3000,
    private onPoll?: PollHook,
  ) {}

  /** Follows systemd through the agent until `unfollow`. */
  follow(opts: { waitMs?: number; fallbackMs?: number } = {}) {
    if (this.following) return
    this.following = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    void this.followLoop(opts.waitMs ?? 300_000, opts.fallbackMs ?? 10_000)
  }

  unfollow() {
    this.following = false
  }

  private async followLoop(waitMs: number, fallbackMs: number) {
    let cursor: string | null = null
    while (this.following) {
      try {
        const r: Result<'service.wait'> = await this.agent(
          'service.wait',
          { servers: this.names(), after: cursor, timeoutMs: waitMs },
          { timeoutMs: waitMs + 15_000 },
        )
        cursor = r.cursor
        await this.poke()
        if (!r.following) await Bun.sleep(fallbackMs)
      } catch {
        // The agent is down or restarting (an older one doesn't know service.wait).
        cursor = null
        await Bun.sleep(fallbackMs)
        await this.poke()
      }
    }
  }

  /** The latest known states, or a fresh poll if nothing is watching yet. */
  async current(): Promise<StatusMap> {
    if (!this.timer && !(this.following && Object.keys(this.last).length)) await this.poke()
    return this.last
  }

  watch(listener: Listener): () => void {
    this.listeners.add(listener)
    if (this.following) {
      void this.poke().then(() => listener(this.last))
    } else if (!this.timer) {
      this.timer = setInterval(() => void this.poke(), this.intervalMs)
      void this.poke().then(() => listener(this.last))
    } else {
      listener(this.last)
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    }
  }

  /** Polls now (sharing a poll already in flight) and tells watchers if anything moved. */
  async poke(): Promise<StatusMap> {
    this.polling ??= this.poll().finally(() => (this.polling = null))
    await this.polling
    return this.last
  }

  private async poll() {
    const names = this.names()
    const full = await Promise.all(
      names.map((server) =>
        this.agent('service.status', { server }, { timeoutMs: 5000 }).catch(() => null),
      ),
    )
    const next = Object.fromEntries(names.map((n, i) => [n, full[i]?.active ?? 'unknown']))
    const changed =
      Object.keys(next).length !== Object.keys(this.last).length ||
      names.some((n) => next[n] !== this.last[n])
    this.last = next
    if (changed) for (const l of this.listeners) l(next)
    if (this.onPoll) {
      try {
        await this.onPoll(Object.fromEntries(names.map((n, i) => [n, full[i] ?? null])))
      } catch (err) {
        console.error('[flytower] after-poll hook failed', err)
      }
    }
  }
}
