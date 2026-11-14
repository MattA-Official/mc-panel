import { subscribeAgent } from '@flytower/protocol/client'
import { StatusWatcher, type StatusEvents } from '../jobs/status'
import { schema } from '../db'

let watcher: StatusWatcher | undefined

/** The one status watcher for this process. */
export function useStatus(): StatusWatcher {
  watcher ??= new StatusWatcher(
    agent,
    () =>
      useDb()
        .select({ name: schema.servers.name })
        .from(schema.servers)
        .all()
        .map((r) => r.name),
    3000,
    (statuses) => useCrashes().observe(statuses),
  )
  return watcher
}

/** `service.events` through the agent, when `agent.hello` offers it. */
export const agentStatusEvents: StatusEvents = async (servers, h) => {
  const hello = await agentHello()
  if (!hello?.subscriptions.includes('service.events')) return null
  return subscribeAgent(
    'service.events',
    { servers },
    {
      onStart: (r, again) => h.start(r.states, again),
      onEvent: (e) => h.change(e.server, e.status),
      onEnd: (end) => {
        if (end.reason === 'refused') forgetAgentHello()
        h.end()
      },
    },
    { socketPath: useRuntimeConfig().agentSocket },
  )
}
