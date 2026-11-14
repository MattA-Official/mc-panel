import { LogStreams, agentSource, localSource } from '../logs/streams'

let streams: LogStreams | undefined
/** The agent refused to follow a log once: follow the files from then on. */
let agentFailed = false

/**
 * The one set of log streams for this process. Through the agent's `log.follow` when
 * `agent.hello` offers it, otherwise by following the files directly, as before.
 */
export function useLogStreams(): LogStreams {
  if (!streams) {
    const { serversDir, agentSocket } = useRuntimeConfig()
    const local = localSource(serversDir)
    const viaAgent = agentSource(agentSocket)
    streams = new LogStreams(
      async () => {
        if (agentFailed) return local
        const h = await agentHello()
        return h?.subscriptions.includes('log.follow') ? viaAgent : local
      },
      local,
      () => {
        agentFailed = true
        forgetAgentHello()
      },
    )
  }
  return streams
}
