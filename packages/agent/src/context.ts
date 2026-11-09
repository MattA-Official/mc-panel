import type { Exec } from './exec.ts'

/** Everything a handler may touch. Tests swap these for fakes. */
export interface AgentContext {
  exec: Exec
  version: string
  paths: {
    servers: string // /srv/kiln/servers
    runtimes: string // /opt/kiln/runtimes
    archive: string // /var/lib/kiln/archive
  }
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
