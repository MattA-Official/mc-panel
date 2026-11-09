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

export function fakeContext(exec: Exec) {
  const audit: AuditEvent[] = []
  const ctx: AgentContext = {
    exec,
    version: '0.0.0-test',
    paths: {
      servers: '/tmp/kiln/servers',
      runtimes: '/tmp/kiln/runtimes',
      archive: '/tmp/kiln/archive',
    },
    log: (e) => audit.push(e),
  }
  return { ctx, audit }
}
