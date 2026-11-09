import type { Result } from '@flytower/protocol'
import type { AgentCall } from './runner'

export type ServiceStatus = Result<'service.status'>
export type ServiceState = ServiceStatus['active']
export type StatusMap = Record<string, ServiceState>
type Listener = (statuses: StatusMap) => void
/** Every poll's full answers; null where the agent didn't answer. */
type PollHook = (statuses: Record<string, ServiceStatus | null>) => void | Promise<void>

/**
 * Keeps an eye on every server's systemd state: every few seconds while a browser is
 * watching, and more slowly in the background (see `background`) so crashes are noticed
 * with nobody looking. Listeners get the full map on subscribe and again on any change.
 */
export class StatusWatcher {
  private listeners = new Set<Listener>()
  private timer: ReturnType<typeof setInterval> | null = null
  private last: StatusMap = {}
  private polling: Promise<void> | null = null
  private slow: ReturnType<typeof setInterval> | null = null

  constructor(
    private agent: AgentCall,
    private names: () => string[],
    private intervalMs = 3000,
    private onPoll?: PollHook,
  ) {}

  /** Polls every `ms` even with nobody watching. */
  background(ms: number) {
    if (this.slow) return
    this.slow = setInterval(() => {
      if (!this.timer) void this.poke()
    }, ms)
  }

  stopBackground() {
    if (this.slow) clearInterval(this.slow)
    this.slow = null
  }

  /** The latest known states, or a fresh poll if nothing is watching yet. */
  async current(): Promise<StatusMap> {
    if (!this.timer) await this.poke()
    return this.last
  }

  watch(listener: Listener): () => void {
    this.listeners.add(listener)
    if (!this.timer) {
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
