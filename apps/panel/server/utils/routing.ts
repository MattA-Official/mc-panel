import { callRouter } from '@flytower/protocol/client'
import { Routing } from '../routing/service'

let routing: Routing | undefined

/** The one hostname-routing service for this process (#76). */
export function useRouting(): Routing {
  routing ??= new Routing({
    db: useDb(),
    agent,
    router: (verb, params) =>
      callRouter(verb, params, { socketPath: useRuntimeConfig().routerSocket, timeoutMs: 10_000 }),
    writeProperties,
    statuses: () => useStatus().current(),
    brand: () => useBranding().settings().name,
  })
  return routing
}
