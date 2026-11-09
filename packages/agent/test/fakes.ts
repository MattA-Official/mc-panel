import type { AgentContext, AuditEvent } from '../src/context.ts'
import type { Exec, ExecResult } from '../src/exec.ts'

export interface FakeCall {
  file: string
  args: readonly string[]
}

/** An exec that answers from a table keyed by "file arg arg …" and records every call. */
export function fakeExec(answers: Record<string, Partial<ExecResult>> = {}) {
  const calls: FakeCall[] = []
  const exec: Exec = async (file, args) => {
    calls.push({ file, args })
    const key = [file, ...args].join(' ')
    const hit = answers[key] ?? Object.entries(answers).find(([k]) => key.startsWith(k))?.[1]
    return { code: 0, stdout: '', stderr: '', ...hit }
  }
  return { exec, calls }
}

export function fakeContext(
  exec: Exec,
  fetchImpl: typeof fetch = async () => new Response('not stubbed', { status: 599 }),
  paths: AgentContext['paths'] = {
    servers: '/tmp/kiln/servers',
    runtimes: '/tmp/kiln/runtimes',
    archive: '/tmp/kiln/archive',
    config: '/tmp/kiln/etc',
    systemd: '/tmp/kiln/systemd',
  },
) {
  const audit: AuditEvent[] = []
  const ctx: AgentContext = {
    exec,
    fetch: fetchImpl,
    arch: 'x64',
    panelGroup: 'kiln',
    version: '0.0.0-test',
    paths,
    log: (e) => audit.push(e),
  }
  return { ctx, audit }
}
