import { fabricProvider } from './fabric.ts'
import { Mojang, vanillaProvider } from './mojang.ts'
import type { Fetch, LoaderId, LoaderProvider } from './types.ts'

export * from './types.ts'
export { downloadVerified } from './download.ts'
export { dashed, lookupPlayer, offlineUuid, PLAYER_NAME, type PlayerProfile } from './players.ts'

/** The built-in, trusted loader providers. */
export function createLoaders(
  fetchImpl: Fetch = globalThis.fetch,
): Record<LoaderId, LoaderProvider> {
  const mojang = new Mojang(fetchImpl)
  return { vanilla: vanillaProvider(mojang), fabric: fabricProvider(fetchImpl, mojang) }
}
