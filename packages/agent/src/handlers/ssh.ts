/**
 * SSH in the firewall: closed for good once the panel works, opened briefly in an
 * emergency. The timer that closes it lives here, in the agent, and survives restarts
 * through a small state file.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentError, type Params, type Result } from '@flytower/protocol'
import type { AgentContext } from '../context.ts'

export const SSH_COMMENT = 'flytower emergency ssh'

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const now = (ctx: AgentContext) => (ctx.now ?? Date.now)()
const statePath = (ctx: AgentContext) => join(ctx.paths.state, 'ssh.json')

async function run(ctx: AgentContext, file: string, args: string[]) {
  const r = await ctx.exec(file, args)
  if (r.code !== 0) {
    throw new AgentError('failed', `${file} ${args[0] ?? ''}: ${r.stderr.trim() || 'failed'}`)
  }
  return r.stdout
}

/** The ports sshd listens on, from its effective config; 22 if that can't be read. */
export async function sshPorts(ctx: AgentContext): Promise<number[]> {
  const r = await ctx.exec('sshd', ['-T'])
  const ports = [...r.stdout.matchAll(/^port (\d+)$/gm)].map((m) => Number(m[1]))
  return ports.length ? [...new Set(ports)] : [22]
}

/** Numbers of the ufw rules that let SSH in, highest first so deleting doesn't renumber. */
export function sshRuleNumbers(statusNumbered: string, ports: number[]): number[] {
  const targets = new Set(['OpenSSH', ...ports.flatMap((p) => [`${p}/tcp`, `${p}`])])
  return [...statusNumbered.matchAll(/^\[\s*(\d+)\]\s+(\S+)(?: \(v6\))?\s+(?:ALLOW|LIMIT)\b/gm)]
    .filter((m) => targets.has(m[2]!))
    .map((m) => Number(m[1]))
    .sort((a, b) => b - a)
}

interface SshFile {
  closesAt: string
}

async function readState(ctx: AgentContext): Promise<SshFile | null> {
  try {
    return JSON.parse(await readFile(statePath(ctx), 'utf8')) as SshFile
  } catch {
    return null
  }
}

async function current(ctx: AgentContext): Promise<Result<'ssh.status'>> {
  const ports = await sshPorts(ctx)
  const out = (await ctx.exec('ufw', ['status', 'numbered'])).stdout
  const state = await readState(ctx)
  return {
    open: sshRuleNumbers(out, ports).length > 0,
    ports,
    closesAt: state?.closesAt ?? null,
    firewall: /^Status: active/m.test(out),
  }
}

async function closeNow(ctx: AgentContext) {
  const ports = await sshPorts(ctx)
  const out = (await ctx.exec('ufw', ['status', 'numbered'])).stdout
  for (const n of sshRuleNumbers(out, ports))
    await run(ctx, 'ufw', ['--force', 'delete', String(n)])
  await rm(statePath(ctx), { force: true })
  clearTimeout(timers.get(ctx.paths.state))
  timers.delete(ctx.paths.state)
}

function arm(ctx: AgentContext, closesAt: number) {
  clearTimeout(timers.get(ctx.paths.state))
  const timer = setTimeout(
    () => {
      timers.delete(ctx.paths.state)
      closeNow(ctx).then(
        () => console.log('emergency SSH window ended; SSH closed'),
        (err) => console.error('closing SSH at the end of the window failed', err),
      )
    },
    Math.max(0, closesAt - now(ctx)),
  )
  timer.unref?.()
  timers.set(ctx.paths.state, timer)
}

/** When an emergency opening will close, if one is armed. For tests. */
export const armed = (ctx: AgentContext) => timers.has(ctx.paths.state)

export async function status(_p: Params<'ssh.status'>, ctx: AgentContext) {
  return current(ctx)
}

export async function set(p: Params<'ssh.set'>, ctx: AgentContext): Promise<Result<'ssh.set'>> {
  const before = await current(ctx)
  if (!before.firewall) {
    throw new AgentError(
      'failed',
      'the firewall (ufw) is off, so SSH is reachable whatever this says; turn ufw on first',
    )
  }
  if (!p.open) {
    await closeNow(ctx)
    return current(ctx)
  }
  if (!before.open) {
    for (const port of before.ports) {
      await run(ctx, 'ufw', ['allow', `${port}/tcp`, 'comment', SSH_COMMENT])
    }
  }
  if (p.minutes !== undefined) {
    const closesAt = now(ctx) + p.minutes * 60_000
    await mkdir(ctx.paths.state, { recursive: true, mode: 0o700 })
    await writeFile(
      statePath(ctx),
      JSON.stringify({ closesAt: new Date(closesAt).toISOString() }),
      {
        mode: 0o600,
      },
    )
    arm(ctx, closesAt)
  } else {
    // Open for good: no timer.
    await rm(statePath(ctx), { force: true })
    clearTimeout(timers.get(ctx.paths.state))
    timers.delete(ctx.paths.state)
  }
  return current(ctx)
}

/** At boot: close a window that ended while the agent was down, or re-arm one still open. */
export async function restoreSsh(ctx: AgentContext) {
  const state = await readState(ctx)
  if (!state) return
  const at = Date.parse(state.closesAt)
  if (!Number.isFinite(at) || at <= now(ctx)) await closeNow(ctx)
  else arm(ctx, at)
}
