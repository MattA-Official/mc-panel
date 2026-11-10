import { callAgent, type CallOptions } from '@flytower/protocol/client'
import type { Params, Result, Verb } from '@flytower/protocol'

const SERVICE_ACTIONS: readonly string[] = ['service.stop', 'service.restart']

/**
 * Calls the root helper. Server-side only. Stopping or restarting a server through here
 * tells crash detection to expect it, so it's never counted as a crash.
 */
export function agent<V extends Verb>(
  verb: V,
  params: Params<V>,
  opts: Omit<CallOptions, 'socketPath'> = {},
): Promise<Result<V>> {
  const { agentSocket } = useRuntimeConfig()
  const call = callAgent(verb, params, { socketPath: agentSocket, ...opts })
  if (!SERVICE_ACTIONS.includes(verb)) return call
  const done = useCrashes().expect((params as { server: string }).server)
  return call.finally(done)
}
