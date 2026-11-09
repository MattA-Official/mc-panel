import { callAgent, type CallOptions } from '@flytower/protocol/client'
import type { Params, Result, Verb } from '@flytower/protocol'

/** Calls the root helper. Server-side only. */
export function agent<V extends Verb>(
  verb: V,
  params: Params<V>,
  opts: Omit<CallOptions, 'socketPath'> = {},
): Promise<Result<V>> {
  const { agentSocket } = useRuntimeConfig()
  return callAgent(verb, params, { socketPath: agentSocket, ...opts })
}
