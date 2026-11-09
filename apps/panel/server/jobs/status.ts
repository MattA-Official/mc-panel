import type { Result } from '@flytower/protocol'
import type { AgentCall } from './runner'

export type ServiceState = Result<'service.status'>['active']
export type StatusMap = Record<string, ServiceState>
type Listener = (statuses: StatusMap) => void

/**
 * Keeps an eye on every server's systemd state while a browser is watching, and only then.
 * Listeners get the full map on subscribe and again whenever anything changes.
 */
export class StatusWatcher {
  private listeners = new Set<Listener>()
  private timer: ReturnType<typeof setInterval> | null = null
  private last: StatusMap = {}
  private polling: Promise<void> | null = null

  constructor(
    private agent: AgentCall,
    private names: () => string[],
    private intervalMs = 3000,
    /** Called with every poll's states, changed or not (notifications use it). */
    private onPoll?: (statuses: StatusMap) => void,
  ) {}

  /** The latest known states, or a fresh poll if nothing is watching yet. */
  async current(): Promise<StatusMap> {
    if (!this.timer) await this.poll()
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
    const states = await Promise.all(
      names.map((server) =>
        this.agent('service.status', { server }, { timeoutMs: 5000 }).then(
          (r) => r.active,
          () => 'unknown' as const,
        ),
      ),
    )
    const next = Object.fromEntries(names.map((n, i) => [n, states[i]!]))
    const changed =
      Object.keys(next).length !== Object.keys(this.last).length ||
      names.some((n) => next[n] !== this.last[n])
    this.last = next
    try {
      this.onPoll?.(next)
    } catch (err) {
      console.error('[flytower] status hook failed', err)
    }
    if (changed) for (const l of this.listeners) l(next)
  }
}
