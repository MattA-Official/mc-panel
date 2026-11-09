import type { Exec } from './exec.ts'

/** Everything a handler may touch. Tests swap these for fakes. */
export interface AgentContext {
  exec: Exec
  /** Global fetch in production; a stub in tests. */
  fetch: typeof fetch
  /** CPU architecture as Node reports it (x64, arm64). */
  arch: string
  version: string
  paths: {
    servers: string // /srv/flytower/servers
    runtimes: string // /opt/flytower/runtimes
    archive: string // /var/lib/flytower/archive
    config: string // /etc/flytower
    systemd: string // /etc/systemd/system
  }
  /** The panel's group. Server folders are group-owned by it so the panel can manage files. */
  panelGroup: string
  log: (event: AuditEvent) => void
}

export interface AuditEvent {
  at: string
  id: string
  verb: string
  outcome: 'ok' | 'error'
  code?: string
  ms: number
}
