import type { InjectionKey, Ref } from 'vue'

export interface ServerContext {
  server: Ref<Server | null | undefined>
  status: Ref<ServiceState>
  health: Ref<Health>
  refresh: () => Promise<void>
}

const key: InjectionKey<ServerContext> = Symbol('server')

/** The server page shares its loaded server and live status with its tabs. */
export const provideServerContext = (ctx: ServerContext) => provide(key, ctx)

export function useServerContext(): ServerContext {
  const ctx = inject(key)
  if (!ctx) throw new Error('useServerContext() used outside a server page')
  return ctx
}
