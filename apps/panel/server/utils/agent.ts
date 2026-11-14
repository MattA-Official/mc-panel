import { callAgent, type CallOptions } from '@flytower/protocol/client'
import { AgentError, type Params, type Result, type Verb } from '@flytower/protocol'

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

let hello: Promise<Result<'agent.hello'> | null> | undefined

/**
 * Which agent is running and what it can do, asked once. Null for an agent that speaks
 * protocol 1 only (one that doesn't know `agent.hello`). If the agent can't be reached, the
 * answer is null this time and it's asked again next time.
 */
export function agentHello(): Promise<Result<'agent.hello'> | null> {
  hello ??= agent('agent.hello', {}, { timeoutMs: 5000 }).catch((err: unknown) => {
    if (!(err instanceof AgentError && err.code === 'unknown_verb')) hello = undefined
    return null
  })
  return hello
}

/** Asks `agent.hello` again next time, such as after a subscription was refused. */
export function forgetAgentHello() {
  hello = undefined
}
