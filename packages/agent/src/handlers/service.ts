import { AgentError, unitName, type Params, type Result } from '@flytower/protocol'
import type { AgentContext } from '../context.ts'

const ACTIVE_STATES = ['active', 'inactive', 'activating', 'deactivating', 'failed'] as const

async function systemctl(ctx: AgentContext, args: string[]) {
  const r = await ctx.exec('systemctl', args)
  if (r.code !== 0) throw new AgentError('failed', r.stderr.trim() || `systemctl ${args[0]} failed`)
  return r.stdout
}

/** Refuse to act on a unit systemd has never heard of, rather than letting systemctl guess. */
async function assertKnown(ctx: AgentContext, server: string) {
  const r = await ctx.exec('systemctl', [
    'show',
    unitName(server),
    '--property=LoadState',
    '--value',
  ])
  if (r.stdout.trim() !== 'loaded') throw new AgentError('not_found', `no server called ${server}`)
}

export async function status(
  p: Params<'service.status'>,
  ctx: AgentContext,
): Promise<Result<'service.status'>> {
  await assertKnown(ctx, p.server)
  const r = await ctx.exec('systemctl', [
    'show',
    unitName(p.server),
    '--property=ActiveState,ActiveEnterTimestamp',
  ])
  const props = Object.fromEntries(
    r.stdout
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  )
  const state = props.ActiveState as string | undefined
  const active = (ACTIVE_STATES as readonly string[]).includes(state ?? '')
    ? (state as (typeof ACTIVE_STATES)[number])
    : 'unknown'
  return { active, since: props.ActiveEnterTimestamp || null }
}

const action =
  (verb: 'start' | 'stop' | 'restart') =>
  async (p: { server: string }, ctx: AgentContext): Promise<Record<string, never>> => {
    await assertKnown(ctx, p.server)
    await systemctl(ctx, [verb, unitName(p.server)])
    return {}
  }

export const start = action('start')
export const stop = action('stop')
export const restart = action('restart')

/** systemd prints this, or "[not set]", when it has no figure. */
const UNSET = '18446744073709551615'

/** Splits `systemctl show a b c` output into one property map per unit. */
export function parseShow(stdout: string): Record<string, string>[] {
  return stdout
    .split(/\n\s*\n/)
    .map((block) =>
      Object.fromEntries(
        block
          .split('\n')
          .filter((l) => l.includes('='))
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      ),
    )
    .filter((m) => Object.keys(m).length > 0)
}

const figure = (v: string | undefined) => (v && v !== UNSET && /^\d+$/.test(v) ? Number(v) : null)

export async function usage(
  p: Params<'service.usage'>,
  ctx: AgentContext,
): Promise<Result<'service.usage'>> {
  if (p.servers.length === 0) return { usage: {} }
  const units = new Map(p.servers.map((s) => [unitName(s), s]))
  const r = await ctx.exec('systemctl', [
    'show',
    ...units.keys(),
    '--property=Id,ActiveState,CPUUsageNSec,MemoryCurrent',
  ])
  const out: Result<'service.usage'>['usage'] = {}
  for (const props of parseShow(r.stdout)) {
    const server = units.get(props.Id ?? '')
    if (!server) continue
    const active = props.ActiveState === 'active'
    out[server] = {
      active,
      cpuNs: active ? figure(props.CPUUsageNSec) : null,
      memoryBytes: active ? figure(props.MemoryCurrent) : null,
    }
  }
  return { usage: out }
}
