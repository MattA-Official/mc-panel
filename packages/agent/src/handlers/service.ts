import { AgentError, unitName, type Params, type Result } from '@kiln/protocol'
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
